import dotenv from 'dotenv';
dotenv.config();

// Validate environment variables before importing anything else
import './config/env';

import { prisma } from './config/db';
import redis from './config/redis';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs';

const port = env.PORT;

async function connectToDatabase(maxRetries = 5, retryDelay = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Connected to database');
      return;
    } catch (error) {
      logger.warn(
        { err: error, attempt, maxRetries },
        `Database connection attempt ${attempt}/${maxRetries} failed`
      );
      if (attempt === maxRetries) {
        logger.error(
          { err: error },
          'Failed to connect to database after all retries. Server will start but database operations will fail.'
        );
        return; // Don't crash, let server start
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }
}

async function connectToRedis(maxRetries = 5, retryDelay = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await redis.ping();
      logger.info('Connected to Redis');
      return;
    } catch (error) {
      logger.warn(
        { err: error, attempt, maxRetries },
        `Redis connection attempt ${attempt}/${maxRetries} failed`
      );
      if (attempt === maxRetries) {
        logger.error(
          { err: error },
          'Failed to connect to Redis after all retries. Server will start but Redis operations will fail.'
        );
        return; // Don't crash, let server start
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }
}

const server = app.listen(port, async () => {
  logger.info({ port }, 'Server starting...');

  // Connect to services asynchronously (non-blocking)
  // Server will start even if services are temporarily unavailable
  Promise.all([connectToDatabase(), connectToRedis()]).catch((error) => {
    logger.error({ err: error }, 'Error during service connection');
  });

  startBackgroundJobs();

  logger.info({ port }, 'Server running');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down gracefully...');
  await stopBackgroundJobs();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
