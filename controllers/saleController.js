/**
 * controllers/saleController.js
 *
 * Handles:
 *  - Cash sales  → stock deducted immediately, sale marked completed.
 *  - MPesa sales → pending sale + pending Transaction created, STK push sent.
 *                  Stock deducted only after MPesa callback confirms payment.
 */

const Sale        = require('../models/Sale');
const Product     = require('../models/Product');
const Transaction = require('../models/Transaction');
const { asyncHandler, sendResponse, getPagination, paginationMeta } = require('../utils/helpers');
const { initiateStkPush } = require('../utils/mpesa');

// ── GET /api/sales ────────────────────────────────────────────────────────────
const getSales = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { startDate, endDate, paymentMethod, includePending } = req.query;

  const query = {};

  // Default: only completed sales; opt-in to include pending
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

// ── GET /api/sales/pending ────────────────────────────────────────────────────
const getPendingSales = asyncHandler(async (req, res) => {
  const pendingSales = await Sale.find({ status: 'pending' })
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber')
    .sort({ createdAt: -1 });

  sendResponse(res, 200, { data: pendingSales });
});

// ── GET /api/sales/:id ────────────────────────────────────────────────────────
const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('processedBy', 'username')
    .populate('transactionId', 'status checkoutRequestId receiptNumber');

  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }

  sendResponse(res, 200, { data: sale });
});

// ── POST /api/sales ───────────────────────────────────────────────────────────
const createSale = asyncHandler(async (req, res) => {
  const { items, paymentMethod, customerPhone } = req.body;

  if (process.env.NODE_ENV === 'development') {
    console.log('[POST /api/sales] body:', JSON.stringify(req.body, null, 2));
  }

  // ── 1. Validate & enrich items ─────────────────────────────────────────────
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
      productId:   product._id,
      name:        product.name,
      nameSwahili: product.nameSwahili || product.name,
      quantity:    item.quantity,
      unitPrice:   product.sellingPrice,
      total:       lineTotal,
    });
  }

  // ── 2. Build bulkWrite ops (used for cash; MPesa deducts after callback) ────
  const buildStockDeductOps = (items) =>
    items.map((item) => ({
      updateOne: {
        filter: { _id: item.productId, quantity: { $gte: item.quantity } },
        update: { $inc: { quantity: -item.quantity } },
      },
    }));

  // ── 3a. CASH ──────────────────────────────────────────────────────────────
  if (paymentMethod === 'cash') {
    // Deduct stock atomically with condition guard
    const bulkResult = await Product.bulkWrite(buildStockDeductOps(enrichedItems), {
      ordered: false,
    });

    // If any product was not updated it means stock ran out between check and write
    if (bulkResult.modifiedCount < enrichedItems.length) {
      return res.status(409).json({
        success: false,
        message: 'Stock changed between validation and purchase. Please retry.',
      });
    }

    const sale = await Sale.create({
      items:         enrichedItems,
      subtotal,
      total:         subtotal,
      paymentMethod: 'cash',
      status:        'completed',
      customerPhone: customerPhone || undefined,
      processedBy:   req.admin._id,
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Cash sale completed] id=${sale._id} total=${sale.total}`);
    }

    return sendResponse(res, 201, { data: sale }, 'Sale processed successfully');
  }

  // ── 3b. MPESA ─────────────────────────────────────────────────────────────
  if (paymentMethod === 'mpesa') {
    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        message: 'customerPhone is required for M-Pesa payments',
      });
    }

    // Create a pending Transaction record first
    const checkoutRequestId = `CHECKOUT_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const transaction = await Transaction.create({
      checkoutRequestId,
      amount:      subtotal,
      phoneNumber: customerPhone,
      status:      'pending',
    });

    // Create a pending Sale linked to the Transaction
    const sale = await Sale.create({
      items:         enrichedItems,
      subtotal,
      total:         subtotal,
      paymentMethod: 'mpesa',
      status:        'pending',
      transactionId: transaction._id,
      customerPhone,
      processedBy:   req.admin._id,
      mpesaRef:      `PENDING_${checkoutRequestId.slice(0, 8)}`,
    });

    // Trigger STK push — if this fails we cancel cleanly
    let stkResponse;
    try {
      stkResponse = await initiateStkPush(subtotal, customerPhone, 'AgrovetPOS');
    } catch (err) {
      // Cleanup: mark both records as failed so they don't linger
      await Promise.all([
        Transaction.findByIdAndUpdate(transaction._id, {
          status:        'failed',
          failureReason: err.message,
        }),
        Sale.findByIdAndUpdate(sale._id, {
          status:   'cancelled',
          mpesaRef: `FAILED: ${err.message}`,
        }),
      ]);

      return res.status(502).json({
        success: false,
        message: 'Failed to initiate M-Pesa payment. Please try again.',
        detail:  err.response?.data || err.message,
      });
    }

    // Update transaction with Safaricom's real CheckoutRequestID (may differ)
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
        requiresPayment:   true,
        checkoutRequestId: realCheckoutId,
      },
      'STK push sent. Please complete payment on your phone.'
    );
  }

  // Unknown payment method — shouldn't reach here if validation middleware is in place
  return res.status(400).json({ success: false, message: 'Invalid payment method' });
});

// ── GET /api/sales/reports/summary ───────────────────────────────────────────
const getSalesSummary = asyncHandler(async (req, res) => {
  const { period = 'week' } = req.query;
  const now = new Date();
  const startDate = new Date();

  if      (period === 'today') startDate.setHours(0, 0, 0, 0);
  else if (period === 'week')  startDate.setDate(now.getDate() - 7);
  else if (period === 'month') startDate.setDate(now.getDate() - 30);
  else if (period === 'year')  startDate.setFullYear(now.getFullYear() - 1);

  const matchCompleted = { status: 'completed', createdAt: { $gte: startDate } };

  const [summary, dailyTrend, byPaymentMethod] = await Promise.all([
    Sale.aggregate([
      { $match: matchCompleted },
      {
        $group: {
          _id: null,
          totalRevenue:       { $sum: '$total' },
          totalTransactions:  { $sum: 1 },
          avgTransactionValue:{ $avg: '$total' },
          totalItemsSold:     { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: matchCompleted },
      {
        $group: {
          _id:          { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue:      { $sum: '$total' },
          transactions: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: matchCompleted },
      {
        $group: {
          _id:   '$paymentMethod',
          count: { $sum: 1 },
          total: { $sum: '$total' },
        },
      },
    ]),
  ]);

  sendResponse(res, 200, {
    data: {
      summary: summary[0] || {
        totalRevenue: 0, totalTransactions: 0, avgTransactionValue: 0, totalItemsSold: 0,
      },
      dailyTrend,
      byPaymentMethod,
      period,
    },
  });
});

// ── GET /api/sales/reports/top-products ──────────────────────────────────────
const getTopProducts = asyncHandler(async (req, res) => {
  const limit  = Math.min(50, parseInt(req.query.limit) || 10);
  const period = req.query.period || 'month';

  const startDate = new Date();
  if      (period === 'week')  startDate.setDate(startDate.getDate() - 7);
  else if (period === 'month') startDate.setDate(startDate.getDate() - 30);
  else if (period === 'year')  startDate.setFullYear(startDate.getFullYear() - 1);

  const topProducts = await Sale.aggregate([
    { $match: { status: 'completed', createdAt: { $gte: startDate } } },
    { $unwind: '$items' },
    {
      $group: {
        _id:                '$items.productId',
        name:               { $first: '$items.name' },
        totalQuantitySold:  { $sum: '$items.quantity' },
        totalRevenue:       { $sum: '$items.total' },
        transactionCount:   { $sum: 1 },
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