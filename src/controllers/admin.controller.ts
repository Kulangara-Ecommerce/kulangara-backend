import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { Role, Prisma } from '@prisma/client';
import { IUpdateUserRole, IUpdateUserStatus } from '../types/analytics.types';
import { cacheWrapper } from '../services/cache.service';
import { sendAdminEmail, AdminEmailOptions } from '../services/email.service';

const CACHE_KEYS = {
  USERS_LIST: (query: Record<string, unknown>): string => `admin:users:${JSON.stringify(query)}`,
};

// List all users
export const listUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, status, role, search } = req.query;

    if (role && !Object.values(Role).includes(role as Role)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid role provided',
      });
      return;
    }

    const normalizedQuery = {
      page: Number(page),
      limit: Number(limit),
      status: status ? String(status) : undefined,
      role: role ? (String(role) as Role) : undefined,
      search: search ? String(search).trim() : undefined,
    };

    const result = await cacheWrapper(
      CACHE_KEYS.USERS_LIST(normalizedQuery),
      async () => {
        const where: Prisma.UserWhereInput = {
          isActive:
            normalizedQuery.status === 'ACTIVE'
              ? true
              : normalizedQuery.status === 'INACTIVE'
                ? false
                : undefined,
          role: normalizedQuery.role,
          OR: normalizedQuery.search
            ? [
                {
                  email: {
                    contains: normalizedQuery.search,
                    mode: 'insensitive',
                  },
                },
                {
                  firstName: {
                    contains: normalizedQuery.search,
                    mode: 'insensitive',
                  },
                },
                {
                  lastName: {
                    contains: normalizedQuery.search,
                    mode: 'insensitive',
                  },
                },
              ]
            : undefined,
        };

        try {
          const [users, total] = await Promise.all([
            prisma.user.findMany({
              where,
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                createdAt: true,
                lastLoginAt: true,
              },
              skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
              take: normalizedQuery.limit,
              orderBy: { createdAt: 'desc' },
            }),
            prisma.user.count({ where }),
          ]);

          return {
            data: users,
            meta: {
              total,
              page: normalizedQuery.page,
              limit: normalizedQuery.limit,
              totalPages: Math.ceil(total / normalizedQuery.limit),
            },
          };
        } catch (dbError) {
          console.error('Database error in listUsers:', dbError);
          throw new Error('Database operation failed');
        }
      },
      60 // Cache for 1 minute
    );

    res.json({
      status: 'success',
      ...result,
    });
  } catch (error) {
    console.error('Error in listUsers:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users',
    });
  }
};

// Update user role (Super Admin only)
export const updateUserRole = async (
  req: Request<{ id: string }, Record<string, never>, IUpdateUserRole>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User role updated successfully',
      data: { user },
    });
  } catch (error) {
    console.error('Error in updateUserRole:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update user role',
    });
  }
};

// Update user status (Admin only)
export const updateUserStatus = async (
  req: Request<{ id: string }, Record<string, never>, IUpdateUserStatus>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { isActive: status === 'ACTIVE' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User status updated successfully',
      data: { user },
    });
  } catch (error) {
    console.error('Error in updateUserStatus:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update user status',
    });
  }
};

// Send email to users
export const sendEmail = async (
  req: Request<
    Record<string, never>,
    Record<string, never>,
    { body: string; template?: string; to: string[]; subject: string } & Partial<
      Omit<AdminEmailOptions, 'content'>
    >
  >,
  res: Response
): Promise<void> => {
  try {
    const { body, template: _template, ...emailData } = req.body;

    // Map body to content for the email service
    const emailOptions: AdminEmailOptions = {
      ...emailData,
      content: body,
    };

    await sendAdminEmail(emailOptions);

    res.json({
      status: 'success',
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Error in sendEmail:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send email',
    });
  }
};
