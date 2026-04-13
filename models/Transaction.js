import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    merchantRequestId:{ type: String, unique: true, sparse: true },
    checkoutRequestId: { type: String, unique: true, required: true },
    amount: { type: Number, required: true },
    phoneNumber: { type: String, required: true },
    receiptNumber: { type: String },
    transactionDate: { type: String },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    failureReason: { type: String },
    mpesaResultCode: { type: Number },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);