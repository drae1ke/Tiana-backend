const express = require('express');
const router = express.Router();
const { getSales, getSale, getPendingSales, createSale, getSalesSummary, getTopProducts } = require('../controllers/saleController');
const { protect, authorize } = require('../middleware/auth');
const { saleValidation, mongoIdParam } = require('../middleware/validation');

router.use(protect);

router.get('/reports/summary', getSalesSummary);
router.get('/reports/top-products', getTopProducts);
router.get('/pending', getPendingSales);

router.route('/')
  .get(getSales)
  .post(saleValidation, createSale);

router.get('/:id', ...mongoIdParam('id'), getSale);

module.exports = router;