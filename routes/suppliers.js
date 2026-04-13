const express = require('express');
const router = express.Router();
const {
  getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
} = require('../controllers/supplierController');
const { protect, authorize } = require('../middleware/auth');
const { supplierValidation, mongoIdParam } = require('../middleware/validation');

router.use(protect);

router.route('/')
  .get(getSuppliers)
  .post(authorize('admin', 'manager'), supplierValidation, createSupplier);

router.route('/:id')
  .get(...mongoIdParam('id'), getSupplier)
  .put(authorize('admin', 'manager'), ...mongoIdParam('id'), supplierValidation, updateSupplier)
  .delete(authorize('admin'), ...mongoIdParam('id'), deleteSupplier);

module.exports = router;