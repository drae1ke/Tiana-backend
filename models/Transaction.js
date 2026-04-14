/**
 * models/Transaction.js  (CommonJS)
 *
 * Tracks MPesa STK push transactions.
 * Linked to a Sale via Sale.transactionId.
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    merchantRequestId: {
      type:   String,
      unique: true,
      sparse: true, // allow multiple nulls
    },
    checkoutRequestId: {
      type:     String,
      unique:   true,
      required: true,
    },
    amount: {
      type:     Number,
      required: true,
    },
    phoneNumber: {
      type:     String,
      required: true,
    },
    receiptNumber: {
      type: String,
    },
    transactionDate: {
      type: String, // Safaricom returns it as a string (YYYYMMDDHHmmss)
    },
    status: {
      type:    String,
      enum:    ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    failureReason: {
      type: String,
    },
    mpesaResultCode: {
      type: Number,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);