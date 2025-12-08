/**
 * Application constants
 * Centralized location for all magic numbers and configuration values
 */

// Token expiration times (in seconds)
export const TOKEN_EXPIRY = {
  ACCESS_TOKEN: 15 * 60, // 15 minutes
  REFRESH_TOKEN: 7 * 24 * 60 * 60, // 7 days
} as const;

// Token expiration times (in milliseconds) for cookies
export const TOKEN_EXPIRY_MS = {
  ACCESS_TOKEN: TOKEN_EXPIRY.ACCESS_TOKEN * 1000,
  REFRESH_TOKEN: TOKEN_EXPIRY.REFRESH_TOKEN * 1000,
} as const;

// Email verification
export const EMAIL_VERIFICATION = {
  TOKEN_EXPIRY_SECONDS: 24 * 60 * 60, // 24 hours
  TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000,
} as const;

// Password reset
export const PASSWORD_RESET = {
  TOKEN_EXPIRY_SECONDS: 60 * 60, // 1 hour
  TOKEN_EXPIRY_MS: 60 * 60 * 1000,
} as const;

// Cache TTL (Time To Live) in seconds
export const CACHE_TTL = {
  DEFAULT: 3600, // 1 hour
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  VERY_LONG: 86400, // 24 hours
} as const;

// Rate limiting windows (in milliseconds)
export const RATE_LIMIT_WINDOW = {
  API: 15 * 60 * 1000, // 15 minutes
  AUTH: 15 * 60 * 1000, // 15 minutes
  PASSWORD_RESET: 60 * 60 * 1000, // 1 hour
  REGISTRATION: 60 * 60 * 1000, // 1 hour
  EMAIL_VERIFICATION: 15 * 60 * 1000, // 15 minutes
} as const;

// Rate limiting max requests
export const RATE_LIMIT_MAX = {
  API: 100,
  AUTH: 10,
  PASSWORD_RESET: 10,
  REGISTRATION: 10,
  EMAIL_VERIFICATION: 10,
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

// File upload
export const FILE_UPLOAD = {
  MAX_SIZE_MB: 10,
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf'],
  S3_PRESIGNED_URL_EXPIRY: 3600, // 1 hour in seconds
} as const;

// Password requirements
export const PASSWORD = {
  MIN_LENGTH: 8,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL_CHAR: true,
} as const;

// Stock management
export const STOCK = {
  LOW_STOCK_THRESHOLD: 10,
} as const;

// Order
export const ORDER = {
  MAX_ITEMS_PER_ORDER: 100,
} as const;

// User blacklist TTL (in seconds)
export const USER_BLACKLIST_TTL = 24 * 60 * 60; // 24 hours
