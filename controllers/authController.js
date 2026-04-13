const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { asyncHandler, sendResponse } = require('../utils/helpers');

const generateTokens = (adminId) => {
  const accessToken = jwt.sign({ id: adminId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '8h',
  });
  const refreshToken = jwt.sign({ id: adminId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  });
  return { accessToken, refreshToken };
};

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  // Find by username or email
  const admin = await Admin.findOne({
    $or: [{ username }, { email: username }],
    isActive: true,
  }).select('+password');

  if (!admin || !(await admin.comparePassword(password))) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
    });
  }

  const { accessToken, refreshToken } = generateTokens(admin._id);

  // Store refresh token hash in DB
  admin.refreshToken = refreshToken;
  admin.lastLogin = new Date();
  await admin.save({ validateBeforeSave: false });

  sendResponse(res, 200, {
    data: {
      admin,
      accessToken,
      refreshToken,
    },
  }, 'Login successful');
});

// POST /api/auth/refresh
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Refresh token required' });
  }

  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  const admin = await Admin.findById(decoded.id).select('+refreshToken');

  if (!admin || admin.refreshToken !== token) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(admin._id);
  admin.refreshToken = newRefreshToken;
  await admin.save({ validateBeforeSave: false });

  sendResponse(res, 200, { data: { accessToken, refreshToken: newRefreshToken } }, 'Token refreshed');
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  await Admin.findByIdAndUpdate(req.admin._id, { refreshToken: null });
  sendResponse(res, 200, {}, 'Logged out successfully');
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const admin = await Admin.findById(req.admin._id);
  sendResponse(res, 200, { data: admin });
});

// PUT /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const admin = await Admin.findById(req.admin._id).select('+password');
  if (!(await admin.comparePassword(currentPassword))) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect' });
  }

  admin.password = newPassword;
  await admin.save();

  sendResponse(res, 200, {}, 'Password changed successfully');
});

// POST /api/auth/register  (admin-only: create staff accounts)
const register = asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;

  const admin = await Admin.create({ username, email, password, role });
  sendResponse(res, 201, { data: admin }, 'Account created successfully');
});

module.exports = { login, refreshToken, logout, getMe, changePassword, register };