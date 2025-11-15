import { Request, Response, NextFunction } from 'express';
import Tokens from 'csrf';
import { env } from '../config/env';
import { getHeaderString, isString } from '../utils/typeGuards';

const tokens = new Tokens();

// Generate CSRF token
export const generateCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  // Get or create secret from session/cookie
  let secret = req.cookies['csrf-secret'];

  if (!secret) {
    secret = tokens.secretSync();
    res.cookie('csrf-secret', secret, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  // Generate token
  const token = tokens.create(secret);

  // Set token in response header for frontend to read
  res.setHeader('X-CSRF-Token', token);

  // Also attach to request for potential use
  req.csrfToken = token;

  next();
};

// Verify CSRF token for state-changing operations
export const verifyCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  // Skip CSRF for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const secret = req.cookies['csrf-secret'];
  const token = getHeaderString(req.headers, 'x-csrf-token');

  if (!secret || !token || !isString(secret)) {
    res.status(403).json({
      status: 'error',
      message: 'CSRF token missing',
    });
    return;
  }

  if (!tokens.verify(secret, token)) {
    res.status(403).json({
      status: 'error',
      message: 'Invalid CSRF token',
    });
    return;
  }

  next();
};

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      csrfToken?: string;
    }
  }
}
