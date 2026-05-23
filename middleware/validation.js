const { body, param, query, validationResult } = require('express-validator');

const MAX_INLINE_IMAGE_LENGTH = 3_000_000;
const HTTP_IMAGE_PATTERN = /^https?:\/\/\S+$/i;
const DATA_IMAGE_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;

// Middleware to handle validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const imageValidation = body('imageUrl')
  .optional({ nullable: true })
  .customSanitizer((value) => (typeof value === 'string' ? value.trim() : value))
  .custom((value) => {
    if (value === undefined || value === null || value === '') {
      return true;
    }

    if (typeof value !== 'string') {
      throw new Error('Image must be a string');
    }

    if (value.length > MAX_INLINE_IMAGE_LENGTH) {
      throw new Error('Image is too large');
    }

    if (HTTP_IMAGE_PATTERN.test(value) || DATA_IMAGE_PATTERN.test(value)) {
      return true;
    }

    throw new Error('Image must be a valid URL or base64 image');
  });

// Auth validations
const loginValidation = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];

const registerValidation = [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase and a number'),
  body('role').optional().isIn(['admin', 'manager', 'cashier']).withMessage('Invalid role'),
  validate,
];

// Product validations
const productValidation = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('category').isIn(['seeds', 'fertilizers', 'pesticides', 'veterinary', 'tools']).withMessage('Invalid category'),
  body('sku').trim().notEmpty().withMessage('SKU is required'),
  body('quantity').isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
  body('minStockLevel').isInt({ min: 0 }).withMessage('Min stock level must be a non-negative integer'),
  body('buyingPrice').isFloat({ min: 0 }).withMessage('Buying price must be a non-negative number'),
  body('sellingPrice').isFloat({ min: 0 }).withMessage('Selling price must be a non-negative number'),
  body('expiryDate').optional({ nullable: true }).isISO8601().withMessage('Invalid expiry date format'),
  imageValidation,
  validate,
];

const restockValidation = [
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('batchNumber').optional({ nullable: true }).isString().withMessage('Batch number must be text'),
  body('expiryDate').optional({ nullable: true }).isISO8601().withMessage('Invalid expiry date format'),
  imageValidation,
  validate,
];

// Supplier validations
const supplierValidation = [
  body('name').trim().notEmpty().withMessage('Supplier name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional({ nullable: true }).isEmail().withMessage('Invalid email address').normalizeEmail(),
  validate,
];

// Sale validations — productId must be a valid MongoDB ObjectId
const saleValidation = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId')
    .notEmpty().withMessage('Product ID is required')
    .isMongoId().withMessage('Invalid product ID — ensure products are loaded from the API, not localStorage'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('paymentMethod').isIn(['cash', 'mpesa']).withMessage('Payment method must be cash or mpesa'),
  body('customerPhone')
    .if(body('paymentMethod').equals('mpesa'))
    .notEmpty().withMessage('Phone number is required for M-Pesa payments'),
  validate,
];

// Param validation
const mongoIdParam = (paramName = 'id') => [
  param(paramName).isMongoId().withMessage(`Invalid ${paramName}`),
  validate,
];

module.exports = {
  loginValidation,
  registerValidation,
  productValidation,
  supplierValidation,
  saleValidation,
  restockValidation,
  mongoIdParam,
  validate,
};
