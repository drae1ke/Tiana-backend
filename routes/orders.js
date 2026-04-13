const express = require('express');
const router = express.Router();
const {
  getOrders, getOrder, createOrder, updateOrderStatus, deleteOrder, triggerAutoCheck,
} = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/auth');
const { mongoIdParam } = require('../middleware/validation');

router.use(protect);

router.post('/trigger-auto-check', authorize('admin', 'manager'), triggerAutoCheck);

router.route('/')
  .get(getOrders)
  .post(authorize('admin', 'manager'), createOrder);

router.route('/:id')
  .get(...mongoIdParam('id'), getOrder)
  .delete(authorize('admin'), ...mongoIdParam('id'), deleteOrder);

router.patch('/:id/status', authorize('admin', 'manager'), ...mongoIdParam('id'), updateOrderStatus);

module.exports = router;