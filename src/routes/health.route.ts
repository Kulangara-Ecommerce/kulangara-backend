import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import redis from '../config/redis';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Health check endpoint
 * Returns the health status of the application and its dependencies
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
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

/**
 * Readiness check endpoint
 * Used by Kubernetes/Docker to check if the service is ready to accept traffic
 */
router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check critical services
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed');
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Liveness check endpoint
 * Used by Kubernetes/Docker to check if the service is alive
 */
router.get('/live', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
