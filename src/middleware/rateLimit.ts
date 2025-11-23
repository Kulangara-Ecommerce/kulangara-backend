import rateLimit from 'express-rate-limit';
import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from '../constants';

// Shared validate config to silence the X-Forwarded-For + trust proxy warning
const validateConfig = {
  // We know we're behind Nginx and already called app.set('trust proxy', 1)
  // so we don't need express-rate-limit to enforce this.
  xForwardedForHeader: false,
};

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW.API,
  max: RATE_LIMIT_MAX.API,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,  // Disable the `X-RateLimit-*` headers
  validate: validateConfig,
});

// Strict rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW.AUTH,
  max: RATE_LIMIT_MAX.AUTH,
  message: {
    status: 'error',
    message: 'Too many authentication attempts, please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  validate: validateConfig,
});

// Rate limiter for password reset (more restrictive)
export const passwordResetLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW.PASSWORD_RESET,
  max: RATE_LIMIT_MAX.PASSWORD_RESET,
  message: {
    status: 'error',
    message: 'Too many password reset attempts, please try again after 1 hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: validateConfig,
});

// Rate limiter for registration
export const registerLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW.REGISTRATION,
  max: RATE_LIMIT_MAX.REGISTRATION,
  message: {
    status: 'error',
    message: 'Too many registration attempts, please try again after 1 hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: validateConfig,
});

// Rate limiter for email verification resend
export const emailVerificationLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW.EMAIL_VERIFICATION,
  max: RATE_LIMIT_MAX.EMAIL_VERIFICATION,
  message: {
    status: 'error',
    message: 'Too many verification email requests, please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: validateConfig,
});
