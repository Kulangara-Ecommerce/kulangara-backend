import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { isTokenBlacklisted, isUserBlacklisted } from '../services/tokenBlacklist.service';

interface JwtPayload {
  userId: string;
  role: Role;
  jti?: string;
}

// Express Request types are extended in src/types/express.d.ts

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      res.status(401).json({
        status: 'error',
        message: 'Authentication required',
      });
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      res.status(401).json({
        status: 'error',
        message: 'Token has been revoked',
      });
      return;
    }

    // Check if user is blacklisted (for security incidents)
    const userBlacklisted = await isUserBlacklisted(decoded.userId);
    if (userBlacklisted) {
      res.status(401).json({
        status: 'error',
        message: 'Account access has been revoked',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        status: 'error',
        message: 'User not found or inactive',
      });
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        status: 'error',
        message: 'Invalid token',
      });
      return;
    }
    next(error);
  }
};

export const authorize =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        status: 'error',
        message: 'Authentication required',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        status: 'error',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
