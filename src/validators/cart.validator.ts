import { z } from 'zod';
import { ObjectId } from 'bson';

// Validate MongoDB ObjectId
const isValidObjectId = (id: string): boolean => {
  try {
    return ObjectId.isValid(id);
  } catch {
    return false;
  }
};

export const addCartItemSchema = z.object({
  body: z.object({
    productId: z.string().refine(isValidObjectId, {
      message: 'Invalid product ID format',
    }),
    variantId: z
      .string()
      .refine(isValidObjectId, {
        message: 'Invalid variant ID format',
      })
      .optional(),
    quantity: z.number().int().positive(),
  }),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().positive(),
  }),
  params: z.object({
    id: z.string().refine(isValidObjectId, {
      message: 'Invalid item ID format',
    }),
  }),
});
