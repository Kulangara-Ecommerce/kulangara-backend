import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { HttpError } from 'http-errors';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import {
  AppError,
  ValidationError,
  isOperationalError,
  normalizeError,
} from '../utils/errors';
import { env } from '../config/env';

interface ErrorResponse {
  status: 'error';
  message: string;
  errors?: Array<{ field: string; message: string }>;
  code?: string;
  requestId?: string;
}

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Get request ID if available
  const requestId = req.id || req.requestId;

  // Normalize error to AppError
  const appError = normalizeError(err);

  // Log error with context
  const logContext: Record<string, unknown> = {
    err: appError,
    requestId,
    method: req.method,
    path: req.path,
    statusCode: appError.statusCode,
  };

  if (isOperationalError(appError)) {
    logger.warn(logContext, 'Operational error');
  } else {
    logger.error(logContext, 'Unexpected error');
  }

  // Build error response
  const errorResponse: ErrorResponse = {
    status: 'error',
    message: appError.message,
    code: appError.code,
  };

  // Add request ID if available
  if (requestId) {
    errorResponse.requestId = requestId;
  }

  // Add details in development, sanitize in production
  if (env.NODE_ENV === 'development' && appError.details) {
    errorResponse.errors = appError.details.errors as
      | Array<{ field: string; message: string }>
      | undefined;
  }

  // Handle specific error types
  if (appError instanceof ValidationError) {
    errorResponse.errors = appError.errors;
    res.status(appError.statusCode).json(errorResponse);
    return;
  }

  // Handle AppError instances directly (BadRequestError, UnauthorizedError, etc.)
  if (err instanceof AppError) {
    res.status(appError.statusCode).json(errorResponse);
    return;
  }

  // Handle Prisma Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        errorResponse.message = 'Duplicate entry found';
        errorResponse.code = err.code;
        res.status(409).json(errorResponse);
        return;
      case 'P2025':
        errorResponse.message = 'Record not found';
        errorResponse.code = err.code;
        res.status(404).json(errorResponse);
        return;
      case 'P2023':
        errorResponse.message = 'Invalid ID format';
        errorResponse.code = err.code;
        res.status(400).json(errorResponse);
        return;
      default:
        errorResponse.code = err.code;
        res.status(500).json(errorResponse);
        return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    errorResponse.message = 'Validation error';
    res.status(400).json(errorResponse);
    return;
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    errorResponse.message = 'Validation failed';
    errorResponse.errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json(errorResponse);
    return;
  }

  // Handle JWT Errors
  if (err.name === 'JsonWebTokenError') {
    errorResponse.message = 'Invalid token';
    res.status(401).json(errorResponse);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    errorResponse.message = 'Token expired';
    res.status(401).json(errorResponse);
    return;
  }

  // Handle HTTP Errors (e.g., from http-errors package)
  if (err instanceof HttpError) {
    errorResponse.message = err.message;
    res.status(err.status).json(errorResponse);
    return;
  }

  // Send error response
  // Don't expose internal error details in production
  if (env.NODE_ENV === 'production' && !isOperationalError(appError)) {
    errorResponse.message = 'An internal error occurred';
  }

  res.status(appError.statusCode).json(errorResponse);
};

export const notFoundHandler = (req: Request, res: Response) => {
  const requestId = (req as any).id || (req as any).requestId;

  const response: ErrorResponse = {
    status: 'error',
    message: 'Route not found',
    code: 'NOT_FOUND',
  };

  if (requestId) {
    response.requestId = requestId;
  }

  res.status(404).json(response);
};
