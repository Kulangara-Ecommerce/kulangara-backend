import { PrismaClient } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.DATABASE_URL,
    },
  },
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Configure connection pooling for production
// These settings help manage database connections efficiently
if (env.NODE_ENV === 'production') {
  // Prisma uses connection pooling automatically via the connection string
  // For better control, you can add connection pool parameters to DATABASE_URL:
  // postgresql://user:password@host:port/database?connection_limit=10&pool_timeout=20
  // Recommended settings:
  // - connection_limit: 10-20 (adjust based on your database capacity)
  // - pool_timeout: 20 seconds
}
