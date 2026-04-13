// Async error handler middleware
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Standardized response helper
const sendResponse = (res, statusCode, data = {}, message = null) => {
  const response = {
    success: statusCode >= 200 && statusCode < 300,
    ...(message && { message }),
    ...data,
  };
  return res.status(statusCode).json(response);
};

// Pagination helper
const getPagination = (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  return { skip, limit: parseInt(limit) };
};

// Pagination metadata
const paginationMeta = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  return {
    currentPage: page,
    totalPages,
    totalItems: total,
    itemsPerPage: limit,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
};

// Generate SKU for products
const generateSKU = (category, index) => {
  const prefix = {
    seeds: 'SED',
    fertilizers: 'FRT',
    pesticides: 'PST',
    veterinary: 'VET',
    tools: 'TLS'
  };
  return `${prefix[category]}-${String(index).padStart(4, '0')}`;
};

module.exports = {
  asyncHandler,
  sendResponse,
  getPagination,
  paginationMeta,
  generateSKU,
};