import express from 'express';
import { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { prisma } from './config/db';
import redis from './config/redis';
import indexRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import healthRoutes from './routes/health.route';
import { env } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { logger } from './utils/logger';

export const app = express();
app.set('trust proxy', 1);

app.use(morgan('dev'));
app.use(helmet());
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:4200',
      'http://localhost:5173',
      'https://kulangara.org',
      'https://www.kulangara.org',
    ],
    credentials: true,
  })
);

// The Razorpay webhook needs the raw request body to verify its HMAC
// signature, so it must be parsed BEFORE the global express.json() below.
// body-parser (which both express.raw and express.json use internally)
// marks the request as already parsed once one of them has run, so
// express.json() is a no-op for this path.
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cookieParser());

// Add request ID middleware (should be early in the chain)
app.use(requestIdMiddleware);

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
