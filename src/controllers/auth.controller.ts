import { Request, Response } from 'express';
import { prisma } from '../config/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { IUserCreate } from '../types/user.types';
import redis from '../config/redis';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.service';
import { generateTokenWithId, blacklistToken } from '../services/tokenBlacklist.service';
import { logger } from '../utils/logger';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError } from '../utils/errors';
import { TOKEN_EXPIRY, TOKEN_EXPIRY_MS, EMAIL_VERIFICATION, PASSWORD_RESET } from '../constants';

// const isProd = process.env.NODE_ENV === 'production';

import { env } from '../config/env';

const generateTokens = (userId: string, role: string) => {
  // Use token with ID for blacklisting support
  const accessToken = generateTokenWithId({ userId, role });

  const refreshToken = jwt.sign({ userId, role }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${TOKEN_EXPIRY.REFRESH_TOKEN}s`,
  });

  return { accessToken, refreshToken };
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const userData: IUserCreate = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Create verification token
    const verificationToken = uuidv4();

    // Store verification token in Redis
    await redis.set(
      `email_verification:${verificationToken}`, //email_verification:ec2-2031fabv : user@example.com
      userData.email,
      'EX',
      EMAIL_VERIFICATION.TOKEN_EXPIRY_SECONDS
    );

    // Create user
    const user = await prisma.user.create({
      data: {
        ...userData,
        password: hashedPassword,
      },
    });

    // Generate tokens
    const tokens = generateTokens(user.id, user.role);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS.REFRESH_TOKEN),
      },
    });

    // Send verification email
    await sendVerificationEmail(user.email, user.firstName, verificationToken);

    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: TOKEN_EXPIRY_MS.ACCESS_TOKEN,
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: TOKEN_EXPIRY_MS.REFRESH_TOKEN,
    });

    res.status(201).json({
      status: 'success',
      message: 'Registration successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'register' }, 'Registration error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.role);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS.REFRESH_TOKEN),
      },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      status: 'success',
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'login' }, 'Login error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError('No refresh token provided');
    }

    // Verify token exists and is valid
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Token rotation: Use transaction to ensure atomicity
    // Delete old token BEFORE creating new one to prevent replay attacks
    const tokens = await prisma.$transaction(async (tx) => {
      // First, delete the old refresh token (prevents reuse)
      await tx.refreshToken.delete({
        where: { id: tokenRecord.id },
      });

      // Generate new tokens
      const newTokens = generateTokens(tokenRecord.user.id, tokenRecord.user.role);

      // Create new refresh token
      await tx.refreshToken.create({
        data: {
          token: newTokens.refreshToken,
          userId: tokenRecord.user.id,
          expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS.REFRESH_TOKEN),
        },
      });

      return newTokens;
    });

    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: TOKEN_EXPIRY_MS.ACCESS_TOKEN,
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      // secure: isProd,
      // sameSite: isProd ? 'strict' : 'lax',
      secure: true,
      sameSite: 'none',
      maxAge: TOKEN_EXPIRY_MS.REFRESH_TOKEN,
    });

    res.json({
      status: 'success',
      message: 'Token refreshed successfully',
      data: {
        user: {
          id: tokenRecord.user.id,
          email: tokenRecord.user.email,
          firstName: tokenRecord.user.firstName,
          lastName: tokenRecord.user.lastName,
          role: tokenRecord.user.role,
          isVerified: tokenRecord.user.isVerified,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'refreshToken' }, 'Token refresh error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies.accessToken;

    if (!token || !req.user?.id) {
      throw new UnauthorizedError('Unauthorized');
    }

    // Blacklist the access token
    await blacklistToken(token);

    // Delete refresh tokens for the user
    const result = await prisma.refreshToken.deleteMany({
      where: { userId: req.user.id },
    });

    if (result.count === 0) {
      throw new BadRequestError('No active session found');
    }

    res.clearCookie('accessToken', { httpOnly: true, secure: true, sameSite: 'none' });
    res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'none' });

    res.json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'logout', userId: req.user?.id }, 'Logout error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Generate reset token
    const resetToken = uuidv4();

    // Store reset token in Redis
    await redis.set(
      `password_reset:${resetToken}`, //password_reset:ec2-3f ashish
      user.id,
      'EX',
      PASSWORD_RESET.TOKEN_EXPIRY_SECONDS
    );

    // Send password reset email
    await sendPasswordResetEmail(user.email, user.firstName, resetToken);

    res.json({
      status: 'success',
      message: 'Password reset instructions sent to email',
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'forgotPassword' }, 'Forgot password error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    // Verify token
    const userId = await redis.get(`password_reset:${token}`); //password_reset:ec2-3f ashish
    if (!userId) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Delete reset token
    await redis.del(`password_reset:${token}`);

    // Invalidate all refresh tokens
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    res.json({
      status: 'success',
      message: 'Password reset successful',
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'resetPassword' }, 'Reset password error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    // Verify token
    const email = await redis.get(`email_verification:${token}`);
    if (!email) {
      throw new BadRequestError('Invalid or expired verification token');
    }

    // Update user
    await prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    // Delete verification token
    await redis.del(`email_verification:${token}`);

    res.json({
      status: 'success',
      message: 'Email verified successfully',
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'verifyEmail' }, 'Email verification error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestError('Email already verified');
    }

    // Generate new verification token
    const verificationToken = uuidv4();

    // Store verification token in Redis
    await redis.set(
      `email_verification:${verificationToken}`,
      user.email,
      'EX',
      EMAIL_VERIFICATION.TOKEN_EXPIRY_SECONDS
    );

    // Send verification email
    await sendVerificationEmail(user.email, user.firstName, verificationToken);

    res.json({
      status: 'success',
      message: 'Verification email sent',
    });
  } catch (error) {
    logger.error(
      { err: error, endpoint: 'resendVerification', userId: req.user?.id },
      'Resend verification error'
    );
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info({ path: req.path, method: req.method, hasBody: !!req.body }, 'Google auth request received');
    const { token } = req.body;

    if (!token) {
      logger.warn({ body: req.body }, 'Google auth: token missing');
      throw new BadRequestError('Google access token is required');
    }

    logger.debug({ tokenLength: token.length }, 'Google auth: token received');

    let userInfo;
    try {
      // Use v3 endpoint (supports both v2 and v3)
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, statusText: response.statusText, error: errorText },
          'Google API error'
        );
        throw new Error(`Failed to verify token with Google: ${response.status} ${response.statusText}`);
      }

      userInfo = await response.json();
      logger.debug({ userInfo: { email: userInfo.email, hasEmail: !!userInfo.email } }, 'Google userinfo received');
    } catch (error) {
      logger.error({ err: error, endpoint: 'googleAuth', token: token?.substring(0, 20) + '...' }, 'Google token verification error');
      throw new UnauthorizedError('Invalid Google token');
    }

    // Extract user information
    // Support both v2 (verified_email) and v3 (email_verified) field names
    const {
      email,
      given_name,
      family_name,
      picture,
      verified_email, // v2
      email_verified, // v3
    } = userInfo;

    // Use email_verified (v3) if available, fallback to verified_email (v2)
    const isEmailVerified = email_verified ?? verified_email ?? false;

    logger.debug({ email, isEmailVerified, userInfoFields: Object.keys(userInfo) }, 'Extracted user info from Google');

    if (!email) {
      logger.error({ userInfo }, 'Google auth: email not provided by Google');
      throw new BadRequestError('Email not provided by Google');
    }

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email },
    });

    const randomPassword = uuidv4() + Date.now().toString();

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: given_name || user.firstName,
          lastName: family_name || user.lastName,
          avatar: picture || user.avatar,
          isVerified: isEmailVerified || user.isVerified,
          emailVerifiedAt:
            isEmailVerified && !user.emailVerifiedAt ? new Date() : user.emailVerifiedAt,
          lastLoginAt: new Date(),
        },
      });
    } else {
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName: given_name || 'User',
          lastName: family_name || '',
          avatar: picture || null,
          isVerified: isEmailVerified,
          emailVerifiedAt: isEmailVerified ? new Date() : null,
          lastLoginAt: new Date(),
        },
      });
    }

    const tokens = generateTokens(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      status: 'success',
      message: 'Google authentication successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
        },
      },
    });
  } catch (error) {
    // Re-throw operational errors so error handler middleware can handle them
    if (
      error instanceof BadRequestError ||
      error instanceof UnauthorizedError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    // Log unexpected errors
    logger.error({ err: error, endpoint: 'googleAuth' }, 'Google auth error');
    // Re-throw to be handled by error handler middleware
    throw error;
  }
};
