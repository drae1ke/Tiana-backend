const express = require('express');
const { stkPush, stkCallback, getTransactionStatus } = require('../controllers/mpesaController');

const router = express.Router();

router.post('/stk-push', stkPush);
router.post('/stk-callback', stkCallback);
router.get('/transaction/:checkoutRequestId', getTransactionStatus);

module.exports = router;