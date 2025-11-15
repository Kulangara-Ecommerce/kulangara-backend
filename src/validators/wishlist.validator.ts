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

export const addToWishlistSchema = z.object({
  body: z.object({
    productId: z.string().refine(isValidObjectId, {
      message: 'Invalid product ID format',
    }),
  }),
});
