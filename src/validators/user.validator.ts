import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'First name must be at least 2 characters').optional(),
    lastName: z.string().min(2, 'Last name must be at least 2 characters').optional(),
    phone: z.string().optional(),
    avatar: z.string().url('Invalid URL').optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string(),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
        'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
      ),
  }),
});

export const createAddressSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'First name must be at least 2 characters'),
    lastName: z.string().min(2, 'Last name must be at least 2 characters'),
    address: z.string().min(5, 'Address must be at least 5 characters'),
    apartment: z.string().optional(),
    city: z.string().min(2, 'City must be at least 2 characters'),
    state: z.string().min(2, 'State must be at least 2 characters'),
    pincode: z.string().regex(/^\d{6}$/, 'Invalid pincode'),
    phone: z.string().regex(/^\d{10}$/, 'Invalid phone number'),
    isDefault: z.boolean().optional(),
  }),
});

export const updateAddressSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'First name must be at least 2 characters').optional(),
    lastName: z.string().min(2, 'Last name must be at least 2 characters').optional(),
    address: z.string().min(5, 'Address must be at least 5 characters').optional(),
    apartment: z.string().optional(),
    city: z.string().min(2, 'City must be at least 2 characters').optional(),
    state: z.string().min(2, 'State must be at least 2 characters').optional(),
    pincode: z
      .string()
      .regex(/^\d{6}$/, 'Invalid pincode')
      .optional(),
    phone: z
      .string()
      .regex(/^\d{10}$/, 'Invalid phone number')
      .optional(),
    isDefault: z.boolean().optional(),
  }),
});
