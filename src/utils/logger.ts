import pino from 'pino';
import { env } from '../config/env';

const isDevelopment = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    env: env.NODE_ENV,
  },
});

// Helper functions for common logging patterns
export const logError = (error: Error | unknown, context?: Record<string, unknown>): void => {
  if (error instanceof Error) {
    logger.error(
      {
        err: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
        ...context,
      },
      error.message
    );
  } else {
    logger.error({ ...context }, String(error));
  }
};

export const logInfo = (message: string, context?: Record<string, unknown>): void => {
  logger.info(context || {}, message);
};

export const logWarn = (message: string, context?: Record<string, unknown>): void => {
  logger.warn(context || {}, message);
};

export const logDebug = (message: string, context?: Record<string, unknown>): void => {
  logger.debug(context || {}, message);
};
