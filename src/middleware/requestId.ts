import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getHeaderString } from '../utils/typeGuards';

/**
 * Middleware to add a unique request ID to each request
 * This helps with tracing and correlating logs
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Generate or use existing request ID from header
  const requestId = getHeaderString(req.headers, 'x-request-id') || uuidv4();

  // Attach to request object
  req.id = requestId;
  req.requestId = requestId;

  // Add to response header
  res.setHeader('X-Request-ID', requestId);

  next();
};
