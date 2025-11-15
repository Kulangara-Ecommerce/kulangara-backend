import { Router } from 'express';
import {
    register,
    login,
    refreshToken,
    logout,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
  googleAuth,
} from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  authLimiter,
  registerLimiter,
  passwordResetLimiter,
  emailVerificationLimiter,
} from '../middleware/rateLimit';
import {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
  googleAuthSchema,
} from '../validators/auth.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.post('/register', registerLimiter, validateRequest(registerSchema), asyncHandler(register));
router.post('/login', authLimiter, validateRequest(loginSchema), asyncHandler(login));
router.post('/google', authLimiter, validateRequest(googleAuthSchema), asyncHandler(googleAuth));
router.post('/refresh', authLimiter, asyncHandler(refreshToken));
router.post('/logout', authenticate, asyncHandler(logout));
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validateRequest(forgotPasswordSchema),
  asyncHandler(forgotPassword)
);
router.post(
  '/reset-password',
  passwordResetLimiter,
  validateRequest(resetPasswordSchema),
  asyncHandler(resetPassword)
);
router.post('/verify-email/:token', asyncHandler(verifyEmail));
router.post('/resend-verification', emailVerificationLimiter, authenticate, asyncHandler(resendVerification));

export default router;
