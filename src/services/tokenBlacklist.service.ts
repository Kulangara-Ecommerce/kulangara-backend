import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import redis from '../config/redis';
import { logger } from '../utils/logger';
import { TOKEN_EXPIRY, USER_BLACKLIST_TTL } from '../constants';

/**
 * Generate a JWT with a unique ID (jti) for blacklisting
 */
export const generateTokenWithId = (payload: { userId: string; role: string }): string => {
  const jti = uuidv4();
  return jwt.sign({ ...payload, jti }, env.JWT_SECRET, {
    expiresIn: `${TOKEN_EXPIRY.ACCESS_TOKEN}s`,
  });
};

/**
 * Extract JWT ID from token
 */
export const getTokenId = (token: string): string | null => {
  try {
    const decoded = jwt.decode(token) as { jti?: string } | null;
    return decoded?.jti || null;
  } catch {
    return null;
  }
};

/**
 * Blacklist an access token until it expires
 */
export const blacklistToken = async (token: string): Promise<void> => {
  try {
    const decoded = jwt.decode(token) as { exp?: number; jti?: string } | null;

    if (!decoded || !decoded.exp || !decoded.jti) {
      return;
    }

    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    if (expiresIn > 0) {
      // Store in Redis with TTL matching token expiration
      await redis.set(`blacklist:token:${decoded.jti}`, '1', 'EX', expiresIn);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error blacklisting token');
  }
};

/**
 * Check if a token is blacklisted
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  try {
    const jti = getTokenId(token);

    if (!jti) {
      return false;
    }

    const blacklisted = await redis.get(`blacklist:token:${jti}`);
    return blacklisted === '1';
  } catch (error) {
    logger.error({ err: error }, 'Error checking token blacklist');
    // On error, don't block the request (fail open for availability)
    return false;
  }
};

/**
 * Blacklist all tokens for a user (useful for security incidents)
 */
export const blacklistAllUserTokens = async (userId: string): Promise<void> => {
  try {
    // Store user ID in blacklist with a reasonable TTL (e.g., 24 hours)
    // This can be checked in addition to token-level blacklisting
    await redis.set(`blacklist:user:${userId}`, '1', 'EX', USER_BLACKLIST_TTL);
  } catch (error) {
    logger.error({ err: error }, 'Error blacklisting user tokens');
  }
};

/**
 * Check if user is blacklisted
 */
export const isUserBlacklisted = async (userId: string): Promise<boolean> => {
  try {
    const blacklisted = await redis.get(`blacklist:user:${userId}`);
    return blacklisted === '1';
  } catch (error) {
    logger.error({ err: error }, 'Error checking user blacklist');
    return false;
  }
};
