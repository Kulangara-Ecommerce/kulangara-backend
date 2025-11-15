import dotenv from 'dotenv';
dotenv.config();

// Validate environment variables before importing anything else
import './config/env';

import express from 'express';
import { Request, Response } from 'express';
import { prisma } from './config/db';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import redis from './config/redis';
import indexRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import healthRoutes from './routes/health.route';
import { env } from './config/env';
import { logger } from './utils/logger';
import { requestIdMiddleware } from './middleware/requestId';

const app = express();
const port = env.PORT;

app.use(morgan('dev'));
app.use(helmet());
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:4200',
      'http://localhost:5173',
      'https://kulangara.org',
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Add request ID middleware (should be early in the chain)
app.use(requestIdMiddleware);

// app.use('/api/v1/payment/webhook', express.raw({ type: 'application/json' }));

app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Hello kulangara',
    port: env.PORT,
    endpoints: {
      health: '/health',
      api: '/api/v1',
    },
  });
});

// Health check endpoints (before API routes)
// Define health route directly to ensure it works
app.get('/health', async (_req: Request, res: Response): Promise<void> => {
  const health: {
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    uptime: number;
    services: {
      database: 'healthy' | 'unhealthy';
      redis: 'healthy' | 'unhealthy';
    };
    version?: string;
  } = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: 'unhealthy',
      redis: 'unhealthy',
    },
  };

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = 'healthy';
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    health.services.database = 'unhealthy';
    health.status = 'unhealthy';
  }

  try {
    // Check Redis connection
    await redis.ping();
    health.services.redis = 'healthy';
  } catch (error) {
    logger.error({ err: error }, 'Redis health check failed');
    health.services.redis = 'unhealthy';
    health.status = 'unhealthy';
  }

  // Add version if available
  if (process.env.npm_package_version) {
    health.version = process.env.npm_package_version;
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Additional health check routes
app.use('/health', healthRoutes);

app.use('/api/v1', indexRoutes);

app.use(notFoundHandler);

app.use(errorHandler);

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

app.listen(port, async () => {
  logger.info({ port }, 'Server starting...');

  // Connect to services asynchronously (non-blocking)
  // Server will start even if services are temporarily unavailable
  Promise.all([connectToDatabase(), connectToRedis()]).catch((error) => {
    logger.error({ err: error }, 'Error during service connection');
  });

  logger.info({ port }, 'Server running');
});
