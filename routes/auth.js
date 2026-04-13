const express = require('express');
const router = express.Router();
const { login, refreshToken, logout, getMe, changePassword, register } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const { loginValidation, registerValidation } = require('../middleware/validation');

router.post('/login', loginValidation, login);
router.post('/refresh', refreshToken);

router.use(protect);
router.post('/logout', logout);
router.get('/me', getMe);
router.put('/change-password', changePassword);
router.post('/register', authorize('admin'), registerValidation, register);

module.exports = router;