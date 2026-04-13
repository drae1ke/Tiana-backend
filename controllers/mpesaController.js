import Transaction from '../models/Transaction.js';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { initiateStkPush } from '../utils/mpesa.js';

// 1. Initiate STK Push (POS terminal)
export const stkPush = async (req, res) => {
  try {
    const { amount, phoneNumber, saleId } = req.body;

    if (!amount || !phoneNumber || !saleId) {
      return res.status(400).json({ error: 'Amount, phoneNumber, and saleId are required' });
    }

    // Verify sale exists and is pending
    const sale = await Sale.findById(saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    if (sale.status !== 'pending') {
      return res.status(400).json({ error: 'Sale is not in pending status' });
    }
    if (sale.total !== amount) {
      return res.status(400).json({ error: 'Amount does not match sale total' });
    }

    // Create a pending transaction record linked to the sale
    const transaction = new Transaction({
      checkoutRequestId: `CHECKOUT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      amount,
      phoneNumber,
      status: 'pending',
    });
    await transaction.save();

    // Update sale with transaction reference
    sale.transactionId = transaction._id;
    await sale.save();

    // Send STK push to customer's phone
    const stkResponse = await initiateStkPush(amount, phoneNumber, transaction.checkoutRequestId);

    // If Safaricom returns a CheckoutRequestID, update our record
    if (stkResponse.CheckoutRequestID) {
      transaction.checkoutRequestId = stkResponse.CheckoutRequestID;
      await transaction.save();
    }

    res.json({
      message: 'STK push sent successfully',
      checkoutRequestId: transaction.checkoutRequestId,
      responseCode: stkResponse.ResponseCode,
      responseDesc: stkResponse.ResponseDescription,
    });
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
};

// 2. STK Push Callback (called by Safaricom)
export const stkCallback = async (req, res) => {
  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    return res.status(400).json({ error: 'Invalid callback payload' });
  }

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

  try {
    // Find the MPesa Transaction record
    const transaction = await Transaction.findOne({ checkoutRequestId: CheckoutRequestID });
    if (!transaction) {
      console.warn(`Transaction not found for CheckoutRequestID: ${CheckoutRequestID}`);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (ResultCode === 0) {
      // Payment successful
      const items = CallbackMetadata?.Item || [];
      const get = (name) => items.find((i) => i.Name === name)?.Value;

      transaction.status = 'paid';
      transaction.receiptNumber = get('MpesaReceiptNumber');
      transaction.transactionDate = get('TransactionDate');
      transaction.mpesaResultCode = ResultCode;
      await transaction.save();

      // Find the linked Sale and complete it
      const sale = await Sale.findOne({ transactionId: transaction._id });
      if (sale && sale.status === 'pending') {
        // Update sale status
        sale.status = 'completed';
        sale.mpesaRef = transaction.receiptNumber; // optional: store receipt as mpesaRef
        await sale.save();

        // Deduct stock for each product in the sale
        const bulkOps = sale.items.map((item) => ({
          updateOne: {
            filter: { _id: item.productId },
            update: { $inc: { quantity: -item.quantity } },
          },
        }));
        await Product.bulkWrite(bulkOps);

        console.log(`✅ Sale ${sale._id} completed after MPesa payment, stock deducted.`);
      } else {
        console.warn(`Sale not found or already completed for transaction ${transaction._id}`);
      }

      console.log(`✅ Payment completed: ${transaction.receiptNumber} for KES ${transaction.amount}`);
    } else {
      // Payment failed
      transaction.status = 'failed';
      transaction.failureReason = ResultDesc;
      transaction.mpesaResultCode = ResultCode;
      await transaction.save();

      // Optionally mark the linked Sale as cancelled
      const sale = await Sale.findOne({ transactionId: transaction._id });
      if (sale && sale.status === 'pending') {
        sale.status = 'cancelled';
        sale.mpesaRef = `FAILED: ${ResultDesc}`;
        await sale.save();
        console.warn(`❌ Sale ${sale._id} cancelled due to MPesa failure: ${ResultDesc}`);
      }

      console.warn(`❌ Payment failed [${ResultCode}]: ${ResultDesc} - ${CheckoutRequestID}`);
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Callback processing error:', error);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
};
// 3. Get transaction status (optional)
export const getTransactionStatus = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({ checkoutRequestId: req.params.checkoutRequestId })
      .populate('saleId');
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Also get the related sale
    const sale = await Sale.findOne({ transactionId: transaction._id });

    res.json({
      transaction,
      sale: sale ? {
        _id: sale._id,
        status: sale.status,
        total: sale.total,
        items: sale.items.length
      } : null
    });
  } catch (error) {
    console.error('Error fetching transaction status:', error);
    res.status(500).json({ error: 'Failed to fetch transaction status' });
  }
};