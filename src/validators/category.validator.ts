import { z } from 'zod';

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters long'),
    slug: z.string().min(2, 'Slug must be at least 2 characters long'),
    description: z.string().optional(),
    image: z.string().url('Invalid image URL').optional(),
    parentId: z.string().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const updateCategorySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
    slug: z.string().min(2, 'Slug must be at least 2 characters long').optional(),
    description: z.string().optional(),
    image: z.string().url('Invalid image URL').optional(),
    parentId: z.string().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});
