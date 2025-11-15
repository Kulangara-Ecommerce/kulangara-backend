import { z } from 'zod';
import { Role } from '@prisma/client';

export const updateUserRoleSchema = z.object({
  body: z.object({
    role: z.nativeEnum(Role),
  }),
});

export const updateUserStatusSchema = z.object({
  body: z.object({
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']),
  }),
});

export const sendEmailSchema = z.object({
  body: z.object({
    to: z.array(z.string().email()),
    subject: z.string().min(1),
    body: z.string().min(1),
    template: z.string().optional(),
    buttonText: z.string().optional(),
    buttonUrl: z.string().url().optional(),
    footerText: z.string().optional(),
    previewText: z.string().optional(),
  }),
});
