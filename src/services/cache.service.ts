import redis from '../config/redis';
import { logger } from '../utils/logger';
import { CACHE_TTL } from '../constants';

// Default cache duration (1 hour)
const DEFAULT_CACHE_DURATION = CACHE_TTL.DEFAULT;

/**
 * Get data from cache
 * @param key Cache key
 * @returns Cached data or null
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  try {
    const data = await redis.get(key);
    logger.debug({ key, hit: !!data }, 'Cache lookup');
    return data ? JSON.parse(data) : null;
  } catch (error: unknown) {
    logger.warn({ err: error, key }, 'Cache get failed');
    return null;
  }
};

/**
 * Set data in cache
 * @param key Cache key
 * @param data Data to cache
 * @param duration Cache duration in seconds
 */
export const setCache = async <T>(
  key: string,
  data: T,
  duration: number = DEFAULT_CACHE_DURATION
): Promise<void> => {
  try {
    await redis.set(key, JSON.stringify(data), 'EX', duration);
    logger.debug({ key, duration }, 'Cache set');
  } catch (error: unknown) {
    logger.warn({ err: error, key }, 'Cache set failed');
  }
};

/**
 * Delete data from cache
 * @param key Cache key
 */
export const deleteCache = async (key: string): Promise<void> => {
  await redis.del(key);
  logger.debug({ key }, 'Cache deleted');
};

/**
 * Delete multiple keys from cache using pattern
 * @param pattern Pattern to match keys
 */
export const deleteCachePattern = async (pattern: string): Promise<void> => {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(keys);
    logger.debug({ pattern, count: keys.length }, 'Cache pattern deleted');
  }
};

/**
 * Cache wrapper for async functions
 * @param key Cache key
 * @param fn Function to cache
 * @param duration Cache duration in seconds
 * @returns Function result
 */
export const cacheWrapper = async <T>(
  key: string,
  fn: () => Promise<T>,
  duration: number = DEFAULT_CACHE_DURATION
): Promise<T> => {
  try {
    const cached = await getCache<T>(key);
    if (cached) {
      logger.debug({ key }, 'Cache hit');
      return cached;
    }
  } catch (error: unknown) {
    logger.warn({ err: error, key }, 'Cache read failed, proceeding without cache');
  }

  logger.debug({ key }, 'Cache miss, executing function');
  const data = await fn();

  try {
    await setCache(key, data, duration);
    logger.debug({ key }, 'Data cached');
  } catch (error: unknown) {
    logger.warn({ err: error, key }, 'Cache write failed, data still returned');
  }

  return data;
};
