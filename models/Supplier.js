const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    address: {
      type: String,
      trim: true,
    },
    isTrusted: {
      type: Boolean,
      default: false,
    },
    autoOrderEnabled: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Track last auto-order sent per product to avoid spam
    lastAutoOrderDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual to get product count
supplierSchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'supplierId',
  count: true,
});

supplierSchema.index({ name: 1 });
supplierSchema.index({ isTrusted: 1, autoOrderEnabled: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);