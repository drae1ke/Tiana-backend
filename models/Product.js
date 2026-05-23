const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    nameSwahili: {
      type: String,
      trim: true,
      maxlength: [200, 'Swahili name cannot exceed 200 characters'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: ['seeds', 'fertilizers', 'pesticides', 'veterinary', 'tools'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      default: 0,
    },
    minStockLevel: {
      type: Number,
      required: [true, 'Minimum stock level is required'],
      min: [0, 'Minimum stock cannot be negative'],
      default: 10,
    },
    buyingPrice: {
      type: Number,
      required: [true, 'Buying price is required'],
      min: [0, 'Price cannot be negative'],
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Price cannot be negative'],
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    batchNumber: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: [3000000, 'Image data is too large'],
      default: '',
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Track if low-stock alert has been sent (reset when restocked)
    lowStockAlertSent: {
      type: Boolean,
      default: false,
    },
    // Track if expiry alert has been sent for this batch
    expiryAlertSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: days until expiry
productSchema.virtual('daysUntilExpiry').get(function () {
  if (!this.expiryDate) return null;
  const now = new Date();
  const diff = this.expiryDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Virtual: isLowStock
productSchema.virtual('isLowStock').get(function () {
  return this.quantity <= this.minStockLevel;
});

// Virtual: isExpired
productSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual: profit margin
productSchema.virtual('profitMargin').get(function () {
  if (this.buyingPrice === 0) return 0;
  return (((this.sellingPrice - this.buyingPrice) / this.buyingPrice) * 100).toFixed(2);
});

// Indexes for common queries (sku already has unique:true, skip duplicate)
productSchema.index({ category: 1 });
productSchema.index({ quantity: 1, minStockLevel: 1 });
productSchema.index({ expiryDate: 1 });
productSchema.index({ isActive: 1 });

module.exports = mongoose.model('Product', productSchema);
