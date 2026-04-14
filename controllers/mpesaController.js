/**
 * controllers/mpesaController.js  (CommonJS)
 *
 * Endpoints:
 *   POST /api/mpesa/stk-push       → initiate payment from POS
 *   POST /api/mpesa/stk-callback   → Safaricom callback (stock deduction happens here)
 *   GET  /api/mpesa/transaction/:id → query transaction status
 */

const Transaction = require('../models/Transaction');
const Sale        = require('../models/Sale');
const Product     = require('../models/Product');
const { initiateStkPush } = require('../utils/mpesa');

// ── POST /api/mpesa/stk-push ──────────────────────────────────────────────────
const stkPush = async (req, res) => {
  try {
    const { amount, phoneNumber, saleId } = req.body;

    if (!amount || !phoneNumber || !saleId) {
      return res.status(400).json({ error: 'amount, phoneNumber and saleId are required' });
    }

    const sale = await Sale.findById(saleId);
    if (!sale)                      return res.status(404).json({ error: 'Sale not found' });
    if (sale.status !== 'pending')  return res.status(400).json({ error: 'Sale is not pending' });
    if (sale.total !== Number(amount)) return res.status(400).json({ error: 'Amount does not match sale total' });

    // Create tracking transaction
    const checkoutRequestId = `CHECKOUT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const transaction = await Transaction.create({
      checkoutRequestId,
      amount,
      phoneNumber,
      status: 'pending',
    });

    sale.transactionId = transaction._id;
    await sale.save();

    const stkResponse = await initiateStkPush(amount, phoneNumber, 'AgrovetPOS');

    if (stkResponse.CheckoutRequestID && stkResponse.CheckoutRequestID !== checkoutRequestId) {
      transaction.checkoutRequestId = stkResponse.CheckoutRequestID;
      await transaction.save();
    }

    res.json({
      message:           'STK push sent successfully',
      checkoutRequestId: transaction.checkoutRequestId,
      responseCode:      stkResponse.ResponseCode,
      responseDesc:      stkResponse.ResponseDescription,
    });
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
};

// ── POST /api/mpesa/stk-callback ──────────────────────────────────────────────
// Called by Safaricom — must always return 200 quickly.
const stkCallback = async (req, res) => {
  // Acknowledge immediately so Safaricom doesn't retry
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const callback = req.body?.Body?.stkCallback;
  if (!callback) return;

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

  try {
    const transaction = await Transaction.findOne({ checkoutRequestId: CheckoutRequestID });
    if (!transaction) {
      console.warn(`[MPesa callback] Transaction not found for ${CheckoutRequestID}`);
      return;
    }

    if (ResultCode === 0) {
      // ── Payment successful ─────────────────────────────────────────────────
      const items = CallbackMetadata?.Item || [];
      const get   = (name) => items.find((i) => i.Name === name)?.Value;

      transaction.status          = 'paid';
      transaction.receiptNumber   = get('MpesaReceiptNumber');
      transaction.transactionDate = String(get('TransactionDate') || '');
      transaction.mpesaResultCode = ResultCode;
      await transaction.save();

      const sale = await Sale.findOne({ transactionId: transaction._id });
      if (sale && sale.status === 'pending') {
        // Deduct stock atomically with BulkWrite
        const bulkOps = sale.items.map((item) => ({
          updateOne: {
            filter: { _id: item.productId, quantity: { $gte: item.quantity } },
            update: { $inc: { quantity: -item.quantity } },
          },
        }));

        const bulkResult = await Product.bulkWrite(bulkOps, { ordered: false });

        sale.status   = 'completed';
        sale.mpesaRef = transaction.receiptNumber;
        await sale.save();

        console.log(
          `[MPesa callback] Sale ${sale._id} completed. ` +
          `Receipt: ${transaction.receiptNumber}. ` +
          `Stock deducted for ${bulkResult.modifiedCount}/${sale.items.length} items.`
        );
      }
    } else {
      // ── Payment failed ─────────────────────────────────────────────────────
      transaction.status          = 'failed';
      transaction.failureReason   = ResultDesc;
      transaction.mpesaResultCode = ResultCode;
      await transaction.save();

      const sale = await Sale.findOne({ transactionId: transaction._id });
      if (sale && sale.status === 'pending') {
        sale.status   = 'cancelled';
        sale.mpesaRef = `FAILED: ${ResultDesc}`;
        await sale.save();
        console.warn(`[MPesa callback] Sale ${sale._id} cancelled. Reason: ${ResultDesc}`);
      }
    }
  } catch (error) {
    console.error('[MPesa callback] Processing error:', error.message);
  }
};

// ── GET /api/mpesa/transaction/:checkoutRequestId ─────────────────────────────
const getTransactionStatus = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      checkoutRequestId: req.params.checkoutRequestId,
    });

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const sale = await Sale.findOne({ transactionId: transaction._id });

    res.json({
      transaction,
      sale: sale
        ? { _id: sale._id, status: sale.status, total: sale.total, itemCount: sale.items.length }
        : null,
    });
  } catch (error) {
    console.error('Error fetching transaction status:', error);
    res.status(500).json({ error: 'Failed to fetch transaction status' });
  }
};

module.exports = { stkPush, stkCallback, getTransactionStatus };