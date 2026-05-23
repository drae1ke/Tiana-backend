const Product = require('../models/Product');
const { asyncHandler, sendResponse, getPagination, paginationMeta } = require('../utils/helpers');
const { resetAlertFlagsOnRestock } = require('../utils/scheduler');

const normalizeSku = (sku) => String(sku || '').trim().toUpperCase();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const findProductBySku = (sku, excludeId = null) => {
  if (!sku) return null;

  const query = { sku: normalizeSku(sku) };
  if (excludeId) query._id = { $ne: excludeId };

  return Product.findOne(query).select('name sku isActive');
};

// GET /api/products
const getProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { category, search, filter } = req.query;

  const query = { isActive: true };

  if (category && category !== 'all') query.category = category;

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { nameSwahili: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
    ];
  }

  // Special filters
  if (filter === 'low-stock') {
    query.$expr = { $lte: ['$quantity', '$minStockLevel'] };
  } else if (filter === 'expiring') {
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    query.expiryDate = { $gte: new Date(), $lte: in30Days };
  } else if (filter === 'expired') {
    query.expiryDate = { $lt: new Date() };
  }


  const [products, total] = await Promise.all([
    Product.find(query)
      .populate('supplierId', 'name phone email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(query),
  ]);

  sendResponse(res, 200, {
    data: products,
    pagination: paginationMeta(total, page, limit),
  });
});

// GET /api/products/:id
const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isActive: true })
    .populate('supplierId', 'name phone email isTrusted');

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  sendResponse(res, 200, { data: product });
});

// POST /api/products
const createProduct = asyncHandler(async (req, res) => {
  if (req.body.sku) {
    req.body.sku = normalizeSku(req.body.sku);
    const existingProduct = await findProductBySku(req.body.sku);

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: `SKU "${req.body.sku}" is already in use by "${existingProduct.name}".`,
      });
    }
  }

  const product = await Product.create(req.body);
  const populated = await product.populate('supplierId', 'name phone');
  sendResponse(res, 201, { data: populated }, 'Product created successfully');
});

// PUT /api/products/:id
const updateProduct = asyncHandler(async (req, res) => {
  if (req.body.sku) {
    req.body.sku = normalizeSku(req.body.sku);
    const existingProduct = await findProductBySku(req.body.sku, req.params.id);

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: `SKU "${req.body.sku}" is already in use by "${existingProduct.name}".`,
      });
    }
  }

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    req.body,
    { new: true, runValidators: true }
  ).populate('supplierId', 'name phone');

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  // Reset low-stock alert flag if quantity increased above threshold
  await resetAlertFlagsOnRestock(product._id);

  sendResponse(res, 200, { data: product }, 'Product updated successfully');
});

// DELETE /api/products/:id  (soft delete)
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    { isActive: false },
    { new: true }
  );

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  sendResponse(res, 200, {}, 'Product deleted successfully');
});

// GET /api/products/stats/dashboard
const getDashboardStats = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalProducts,
    lowStockCount,
    expiringCount,
    categoryBreakdown,
  ] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({
      isActive: true,
      $expr: { $lte: ['$quantity', '$minStockLevel'] },
    }),
    Product.countDocuments({
      isActive: true,
      expiryDate: { $gte: today, $lte: in30Days },
    }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 }, totalValue: { $sum: { $multiply: ['$quantity', '$sellingPrice'] } } } },
    ]),
  ]);

  sendResponse(res, 200, {
    data: {
      totalProducts,
      lowStockCount,
      expiringCount,
      categoryBreakdown,
    },
  });
});

// PATCH /api/products/:id/restock
const restockProduct = asyncHandler(async (req, res) => {
  const { quantity, batchNumber, expiryDate, imageUrl } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ success: false, message: 'Valid quantity is required' });
  }

  const product = await Product.findById(req.params.id);
  if (!product || !product.isActive) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const updateData = { $inc: { quantity } };
  const setData = {};

  if (batchNumber) setData.batchNumber = batchNumber;
  if (expiryDate) setData.expiryDate = new Date(expiryDate);
  if (hasOwn(req.body, 'imageUrl')) setData.imageUrl = imageUrl || '';

  if (Object.keys(setData).length) {
    updateData.$set = setData;
  }

  const updated = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });

  // Reset alert flags after restocking
  if (updated.quantity > updated.minStockLevel) {
    await Product.findByIdAndUpdate(req.params.id, {
      lowStockAlertSent: false,
      expiryAlertSent: false,
    });
  }

  sendResponse(res, 200, { data: updated }, `Restocked ${quantity} units`);
});

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getDashboardStats,
  restockProduct,
};
