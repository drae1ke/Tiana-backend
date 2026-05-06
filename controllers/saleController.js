const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const { asyncHandler, sendResponse, getPagination, paginationMeta } = require('../utils/helpers');
const { initiateStkPush } = require('../utils/mpesa');

const getSales = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { startDate, endDate, paymentMethod, includePending } = req.query;

  const query = {};

  if (includePending === 'true') {
    query.status = { $in: ['completed', 'pending'] };
  } else {
    query.status = 'completed';
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
      .populate('transactionId', 'status receiptNumber checkoutRequestId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Sale.countDocuments(query),
  ]);

  sendResponse(res, 200, { data: sales, pagination: paginationMeta(total, page, limit) });
});

const getPendingSales = asyncHandler(async (req, res) => {
  const pendingSales = await Sale.find({ status: 'pending' })
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber')
    .sort({ createdAt: -1 });

  sendResponse(res, 200, { data: pendingSales });
});

const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber');

  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }

  sendResponse(res, 200, { data: sale });
});

const createSale = asyncHandler(async (req, res) => {
  const { items, paymentMethod, customerPhone } = req.body;


  if (process.env.NODE_ENV === 'development') {
    console.log('[POST /api/sales] body:', JSON.stringify(req.body, null, 2));
  }

  const enrichedItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = await Product.findOne({ _id: item.productId, isActive: true });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product not found: ${item.productId}`,
      });
    }

    if (product.quantity < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for "${product.name}". Available: ${product.quantity}, Requested: ${item.quantity}`,
      });
    }

    const lineTotal = product.sellingPrice * item.quantity;
    subtotal += lineTotal;

    enrichedItems.push({
      productId: product._id,
      name: product.name,
      nameSwahili: product.nameSwahili || product.name,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      total: lineTotal,
    });
  }

const buildStockDeductOps = (stockItems) =>
    stockItems.map((i) => ({
      updateOne: {
        filter: { _id: i.productId, quantity: { $gte: i.quantity } },
        update: { $inc: { quantity: -i.quantity } },
      },
    }));

  if (paymentMethod === 'cash') {
    const bulkResult = await Product.bulkWrite(buildStockDeductOps(enrichedItems), { ordered: false });

    if (bulkResult.modifiedCount < enrichedItems.length) {
      return res.status(409).json({
        success: false,
        message: 'Stock changed between validation and purchase. Please retry.',
      });
    }

    const sale = await Sale.create({
      items: enrichedItems,
      subtotal,
      total: subtotal,
      paymentMethod: 'cash',
      status: 'completed',
      customerPhone: customerPhone || undefined,
      processedBy: req.admin._id,
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Cash sale completed] id=${sale._id} total=${sale.total}`);
    }

    return sendResponse(res, 201, { data: sale }, 'Sale processed successfully');
  }

  if (paymentMethod === 'mpesa') {
    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        message: 'customerPhone is required for M-Pesa payments',
      });
    }

    const checkoutRequestId = `CHECKOUT_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const transaction = await Transaction.create({
      checkoutRequestId,
      amount: subtotal,
      phoneNumber: customerPhone,
      status: 'pending',
    });

    const sale = await Sale.create({
      items: enrichedItems,
      subtotal,
      total: subtotal,
      paymentMethod: 'mpesa',
      status: 'pending',
      transactionId: transaction._id,
      customerPhone,
      processedBy: req.admin._id,
      mpesaRef: `PENDING_${checkoutRequestId.slice(0, 8)}`,
    });

    let stkResponse;
    try {
      stkResponse = await initiateStkPush(subtotal, customerPhone, 'AgrovetPOS');
    } catch (err) {
      await Promise.all([
        Transaction.findByIdAndUpdate(transaction._id, {
          status: 'failed',
          failureReason: err.message,
        }),
        Sale.findByIdAndUpdate(sale._id, {
          status: 'cancelled',
          mpesaRef: `FAILED: ${err.message}`,
        }),
      ]);

      return res.status(502).json({
        success: false,
        message: 'Failed to initiate M-Pesa payment. Please try again.',
        detail: err.response?.data || err.message,
      });
    }

    const realCheckoutId = stkResponse.CheckoutRequestID || checkoutRequestId;
    if (realCheckoutId !== checkoutRequestId) {
      await Transaction.findByIdAndUpdate(transaction._id, {
        checkoutRequestId: realCheckoutId,
      });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[MPesa sale pending] id=${sale._id} checkoutId=${realCheckoutId}`);
    }

    return sendResponse(
      res,
      201,
      {
        data: sale,
        requiresPayment: true,
        checkoutRequestId: realCheckoutId,
      },
      'STK push sent. Please complete payment on your phone.'
    );
  }

  return res.status(400).json({ success: false, message: 'Invalid payment method' });
});

const getSalesSummary = asyncHandler(async (req, res) => {
  const { period = 'week' } = req.query;
  const now = new Date();
  const startDate = new Date();

  if (period === 'today') startDate.setHours(0, 0, 0, 0);
  else if (period === 'week') startDate.setDate(now.getDate() - 7);
  else if (period === 'month') startDate.setDate(now.getDate() - 30);
  else if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);

  const matchCompleted = { status: 'completed', createdAt: { $gte: startDate } };

  const [summary, dailyTrend, byPaymentMethod] = await Promise.all([
    Sale.aggregate([
      { $match: matchCompleted },
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
      { $match: matchCompleted },
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
      { $match: matchCompleted },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          total: { $sum: '$total' },
        },
      },
    ]),
  ]);

  sendResponse(res, 200, {
    data: {
      summary: summary[0] || {
        totalRevenue: 0,
        totalTransactions: 0,
        avgTransactionValue: 0,
        totalItemsSold: 0,
      },
      dailyTrend,
      byPaymentMethod,
      period,
    },
  });
});

const getTopProducts = asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const period = req.query.period || 'month';

  const startDate = new Date();
  if (period === 'week') startDate.setDate(startDate.getDate() - 7);
  else if (period === 'month') startDate.setDate(startDate.getDate() - 30);
  else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);

  const topProducts = await Sale.aggregate([
    { $match: { status: 'completed', createdAt: { $gte: startDate } } },
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
    { $limit: limit },
  ]);

  sendResponse(res, 200, { data: topProducts });
});

module.exports = {
  getSales,
  getSale,
  getPendingSales,
  createSale,
  getSalesSummary,
  getTopProducts,
};

