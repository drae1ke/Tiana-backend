const Product = require('../models/Product');
const { asyncHandler, sendResponse } = require('../utils/helpers');
const { sendLowStockAlert, sendExpiryAlert } = require('../utils/emailService');
const { checkLowStockAndAutoOrder, checkExpiringProducts } = require('../utils/scheduler');

// GET /api/notifications/alerts
const getAlerts = asyncHandler(async (req, res) => {
  const today = new Date();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [lowStockProducts, expiringProducts, expiredProducts] = await Promise.all([
    Product.find({ isActive: true, $expr: { $lte: ['$quantity', '$minStockLevel'] } })
      .select('name sku quantity minStockLevel category'),
    Product.find({ isActive: true, expiryDate: { $gte: today, $lte: in30Days } })
      .select('name sku quantity expiryDate batchNumber'),
    Product.find({ isActive: true, expiryDate: { $lt: today } })
      .select('name sku quantity expiryDate'),
  ]);

  const enrichedExpiring = expiringProducts.map((p) => ({
    ...p.toObject(),
    daysUntilExpiry: Math.ceil((p.expiryDate - today) / (1000 * 60 * 60 * 24)),
  }));

  sendResponse(res, 200, {
    data: {
      lowStock: { count: lowStockProducts.length, items: lowStockProducts },
      expiring: { count: expiringProducts.length, items: enrichedExpiring },
      expired: { count: expiredProducts.length, items: expiredProducts },
      totalAlerts: lowStockProducts.length + expiringProducts.length + expiredProducts.length,
    },
  });
});

// POST /api/notifications/send-low-stock
const sendLowStockEmailNow = asyncHandler(async (req, res) => {
  const products = await Product.find({ isActive: true, $expr: { $lte: ['$quantity', '$minStockLevel'] } })
    .populate('supplierId');
  if (!products.length) return sendResponse(res, 200, {}, 'No low stock products. Email not sent.');
  await sendLowStockAlert(products);
  sendResponse(res, 200, { data: { count: products.length } }, 'Low stock alert sent successfully');
});

// POST /api/notifications/send-expiry
const sendExpiryEmailNow = asyncHandler(async (req, res) => {
  const today = new Date();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const products = await Product.find({ isActive: true, expiryDate: { $gte: today, $lte: in30Days } });
  if (!products.length) return sendResponse(res, 200, {}, 'No expiring products. Email not sent.');
  const withDays = products.map((p) => ({
    ...p.toObject(),
    daysUntilExpiry: Math.ceil((p.expiryDate - today) / (1000 * 60 * 60 * 24)),
  }));
  await sendExpiryAlert(withDays);
  sendResponse(res, 200, { data: { count: products.length } }, 'Expiry alert sent successfully');
});

// POST /api/notifications/run-scheduler
const runSchedulerNow = asyncHandler(async (req, res) => {
  setImmediate(async () => {
    await checkLowStockAndAutoOrder();
    await checkExpiringProducts();
  });
  sendResponse(res, 200, {}, 'Scheduler cycle triggered in background.');
});

module.exports = { getAlerts, sendLowStockEmailNow, sendExpiryEmailNow, runSchedulerNow };
