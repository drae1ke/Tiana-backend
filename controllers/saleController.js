const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction.js')
const { asyncHandler, sendResponse, getPagination, paginationMeta } = require('../utils/helpers');
const {initiatestkpush} = require('../utils/mpesa');

// GET /api/sales
const getSales = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { startDate, endDate, paymentMethod, includePending } = req.query;

  const query = { status: 'completed' }; // Only show completed sales by default
  
  if (includePending === 'true') {
    query.status = { $in: ['completed', 'pending'] }; // Include pending if requested
  }
  
  if (paymentMethod) query.paymentMethod = paymentMethod;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const [sales, total] = await Promise.all([
    Sale.find(query)
      .populate('processedBy', 'username')
      .populate('transactionId', 'status receiptNumber') // Include transaction info
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Sale.countDocuments(query),
  ]);

  sendResponse(res, 200, { data: sales, pagination: paginationMeta(total, page, limit) });
});

// GET /api/sales/pending
const getPendingSales = asyncHandler(async (req, res) => {
  const pendingSales = await Sale.find({ status: 'pending' })
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber')
    .sort({ createdAt: -1 });

  sendResponse(res, 200, { data: pendingSales });
});

// GET /api/sales/:id
const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber');
  
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  
  sendResponse(res, 200, { data: sale });
});

// POST /api/sales
const createSale = asyncHandler(async (req, res) => {
  const { items, paymentMethod, customerPhone } = req.body;

  if (process.env.NODE_ENV === 'development') {
    console.log('[POST /api/sales] body:', JSON.stringify(req.body, null, 2));
  }

  // Enrich items and check stock (common for both payment methods)
  const enrichedItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = await Product.findOne({ _id: item.productId, isActive: true });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product not found with id: ${item.productId}`,
      });
    }

    if (product.quantity < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for "${product.name}". Available: ${product.quantity}, Requested: ${item.quantity}`,
      });
    }

    const itemTotal = product.sellingPrice * item.quantity;
    subtotal += itemTotal;

    enrichedItems.push({
      productId: product._id,
      name: product.name,
      nameSwahili: product.nameSwahili || product.name,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      total: itemTotal,
    });
  }

  // ------------------- CASH PAYMENT -------------------
  if (paymentMethod === 'cash') {
    const sale = await Sale.create({
      items: enrichedItems,
      subtotal,
      total: subtotal,
      paymentMethod: 'cash',
      status: 'completed',
      customerPhone: customerPhone || undefined,
      processedBy: req.admin._id,
    });

    // Deduct stock immediately
    const bulkOps = enrichedItems.map((item) => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { quantity: -item.quantity } },
      },
    }));
    await Product.bulkWrite(bulkOps);

    if (process.env.NODE_ENV === 'development') {
      console.log(`[POST /api/sales] Cash sale completed: ${sale._id}, total: ${sale.total}`);
    }

    return sendResponse(res, 201, { data: sale }, 'Sale processed successfully');
  }

  // ------------------- MPESA PAYMENT -------------------
  if (paymentMethod === 'mpesa') {
    // 1. Create a pending MPesa Transaction record
    const checkoutRequestId = `CHECKOUT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const transaction = await Transaction.create({
      checkoutRequestId,
      amount: subtotal,
      phoneNumber: customerPhone,
      status: 'pending',
    });

    // 2. Create a pending Sale linked to this Transaction
    const sale = await Sale.create({
      items: enrichedItems,
      subtotal,
      total: subtotal,
      paymentMethod: 'mpesa',
      status: 'pending',
      transactionId: transaction._id,
      customerPhone: customerPhone || undefined,
      processedBy: req.admin._id,
      mpesaRef: `PENDING_${checkoutRequestId.slice(0, 8)}`,
    });

    // 3. Initiate STK Push to customer's phone
    let stkResponse;
    try {
      stkResponse = await initiateStkPush(subtotal, customerPhone, checkoutRequestId);
    } catch (error) {
      // If STK push fails, mark both sale and transaction as failed
      transaction.status = 'failed';
      transaction.failureReason = error.message;
      await transaction.save();

      sale.status = 'cancelled';
      sale.mpesaRef = `FAILED: ${error.message}`;
      await sale.save();

      return res.status(500).json({
        success: false,
        message: 'Failed to initiate MPesa payment. Please try again.',
        error: error.response?.data || error.message,
      });
    }

    // Update transaction with the real CheckoutRequestID from Safaricom (if different)
    if (stkResponse.CheckoutRequestID && stkResponse.CheckoutRequestID !== checkoutRequestId) {
      transaction.checkoutRequestId = stkResponse.CheckoutRequestID;
      await transaction.save();
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[POST /api/sales] MPesa sale pending: ${sale._id}, waiting for payment. CheckoutID: ${transaction.checkoutRequestId}`);
    }

    // Return response – POS will show "awaiting payment"
    return sendResponse(res, 201, {
      data: sale,
      requiresPayment: true,
      paymentMethod: 'mpesa',
      checkoutRequestId: transaction.checkoutRequestId,
      message: 'STK push sent. Please complete payment on your phone.',
    }, 'Sale created, awaiting MPesa payment');
  }

  // Invalid payment method
  return res.status(400).json({ success: false, message: 'Invalid payment method' });
});

// GET /api/sales/reports/summary
const getSalesSummary = asyncHandler(async (req, res) => {
  const { period = 'week' } = req.query;
  const now = new Date();
  let startDate = new Date();

  if (period === 'today') startDate.setHours(0, 0, 0, 0);
  else if (period === 'week') startDate.setDate(now.getDate() - 7);
  else if (period === 'month') startDate.setDate(now.getDate() - 30);
  else if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);

  const [summary, dailyTrend, byPaymentMethod] = await Promise.all([
    Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalTransactions: { $sum: 1 },
          avgTransactionValue: { $avg: '$total' },
          totalItemsSold: { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          transactions: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
  ]);

  sendResponse(res, 200, {
    data: {
      summary: summary[0] || { totalRevenue: 0, totalTransactions: 0, avgTransactionValue: 0, totalItemsSold: 0 },
      dailyTrend,
      byPaymentMethod,
      period,
    },
  });
});

// GET /api/sales/reports/top-products
const getTopProducts = asyncHandler(async (req, res) => {
  const { limit = 10, period = 'month' } = req.query;
  const startDate = new Date();
  if (period === 'week') startDate.setDate(startDate.getDate() - 7);
  else if (period === 'month') startDate.setDate(startDate.getDate() - 30);
  else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);

  const topProducts = await Sale.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.name' },
        totalQuantitySold: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.total' },
        transactionCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: parseInt(limit) },
  ]);

  sendResponse(res, 200, { data: topProducts });
});

module.exports = { getSales, getSale, getPendingSales, createSale, getSalesSummary, getTopProducts };