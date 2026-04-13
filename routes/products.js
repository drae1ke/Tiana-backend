const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getDashboardStats,
  restockProduct,
} = require('../controllers/productController');
const { protect, authorize } = require('../middleware/auth');
const { productValidation, mongoIdParam } = require('../middleware/validation');

router.use(protect);

// Stats endpoint (must be before /:id to avoid route conflict)
router.get('/stats/dashboard', getDashboardStats);

// Main resource routes
router.route('/')
  .get(getProducts)
  .post(authorize('admin', 'manager'), productValidation, createProduct);

router.route('/:id')
  .get(...mongoIdParam('id'), getProduct)
  .put(authorize('admin', 'manager'), ...mongoIdParam('id'), productValidation, updateProduct)
  .delete(authorize('admin'), ...mongoIdParam('id'), deleteProduct);

// Restock endpoint
router.patch('/:id/restock', authorize('admin', 'manager'), ...mongoIdParam('id'), restockProduct);

module.exports = router;