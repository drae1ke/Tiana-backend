const express = require('express');
const router = express.Router();
const {
  getAlerts, sendLowStockEmailNow, sendExpiryEmailNow, runSchedulerNow,
} = require('../controllers/notificationController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/alerts', getAlerts);
router.post('/send-low-stock', authorize('admin', 'manager'), sendLowStockEmailNow);
router.post('/send-expiry', authorize('admin', 'manager'), sendExpiryEmailNow);
router.post('/run-scheduler', authorize('admin'), runSchedulerNow);

module.exports = router;