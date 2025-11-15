import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

const redis = new Redis({
  port: env.REDIS_PORT || 16529,
  host: env.REDIS_HOST || 'redis-16529.c264.ap-south-1-1.ec2.redns.redis-cloud.com',
  username: env.REDIS_USERNAME || 'default',
  password: env.REDIS_PASSWORD || '',
});

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (error) => {
  logger.error({ err: error }, 'Redis connection error');
});

export default redis;
