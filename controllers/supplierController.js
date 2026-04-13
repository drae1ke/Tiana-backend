const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const { asyncHandler, sendResponse, getPagination, paginationMeta } = require('../utils/helpers');

// GET /api/suppliers
const getSuppliers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { search } = req.query;

  const query = { isActive: true };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [suppliers, total] = await Promise.all([
    Supplier.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Supplier.countDocuments(query),
  ]);

  // Add product counts
  const suppliersWithCounts = await Promise.all(
    suppliers.map(async (s) => {
      const productCount = await Product.countDocuments({ supplierId: s._id, isActive: true });
      return { ...s.toJSON(), productCount };
    })
  );

  sendResponse(res, 200, {
    data: suppliersWithCounts,
    pagination: paginationMeta(total, page, limit),
  });
});

// GET /api/suppliers/:id
const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOne({ _id: req.params.id, isActive: true });
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }

  const products = await Product.find({ supplierId: supplier._id, isActive: true })
    .select('name sku quantity minStockLevel category');

  sendResponse(res, 200, { data: { ...supplier.toJSON(), products } });
});

// POST /api/suppliers
const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.create(req.body);
  sendResponse(res, 201, { data: supplier }, 'Supplier created successfully');
});

// PUT /api/suppliers/:id
const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    req.body,
    { new: true, runValidators: true }
  );

  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }

  sendResponse(res, 200, { data: supplier }, 'Supplier updated successfully');
});

// DELETE /api/suppliers/:id  (soft delete)
const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    { isActive: false },
    { new: true }
  );

  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }

  sendResponse(res, 200, {}, 'Supplier deleted successfully');
});

module.exports = { getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier };