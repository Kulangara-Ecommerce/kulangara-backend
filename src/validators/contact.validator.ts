import { z } from 'zod';

export const contactSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Valid email is required'),
    message: z.string().min(1, 'Message is required').max(2000),
    phone: z
      .string()
      .trim()
      .min(5, 'Phone must be at least 5 characters')
      .max(20, 'Phone must be at most 20 characters')
      .optional(),
  }),
});

