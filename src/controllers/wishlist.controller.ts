import { Request, Response } from 'express';
import { prisma } from '../config/db';
// import { ObjectId } from 'bson';
import createError from 'http-errors';
import { cacheWrapper, deleteCache } from '../services/cache.service';

// Cache keys
const CACHE_KEYS = {
  WISHLIST: (userId: string) => `wishlist:${userId}`,
};

// Validate MongoDB ObjectId
// const isValidObjectId = (id: string): boolean => {
//    try {
//     return ObjectId.isValid(id);
//   } catch {
//     return false;
//   }
// };

// Get wishlist
export const getWishlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const cacheKey = CACHE_KEYS.WISHLIST(userId);

    const wishlist = await cacheWrapper(
      cacheKey,
      async () => {
        // Get from database
        return await prisma.wishlist.findMany({
          where: { userId },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                price: true,
                discountedPrice: true,
                images: {
                  where: { isPrimary: true },
                  take: 1,
                  select: {
                    url: true,
                    isPrimary: true,
                  },
                },
              },
            },
          },
        });
      },
      300 // Cache for 5 minutes
    );

    res.json({
      status: 'success',
      data: wishlist,
    });
  } catch (error) {
    console.error('Error in getWishlist:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch wishlist',
    });
  }
};

// Add to wishlist
export const addToWishlist = async (
  req: Request<{}, {}, { productId: string }>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { productId } = req.body;

    if (!productId) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid product ID',
      });
      return;
    }

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      res.status(404).json({
        status: 'error',
        message: 'Product not found',
      });
      return;
    }

    // Add to wishlist
    const wishlistItem = await prisma.wishlist.create({
      data: {
        userId,
        productId,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            discountedPrice: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: {
                url: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });

    // Invalidate cache
    const cacheKey = CACHE_KEYS.WISHLIST(userId);
    await deleteCache(cacheKey);

    res.status(201).json({
      status: 'success',
      message: 'Product added to wishlist',
      data: wishlistItem,
    });
  } catch (error) {
    console.error('Error in addToWishlist:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(400).json({
        status: 'error',
        message: 'Product already in wishlist',
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to add to wishlist',
    });
  }
};

// Remove from wishlist
export const removeFromWishlist = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { id: productId } = req.params;

    if (!productId) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid product ID',
      });
      return;
    }

    // Remove from wishlist
    await prisma.wishlist.delete({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    // Invalidate cache
    const cacheKey = CACHE_KEYS.WISHLIST(userId);
    await deleteCache(cacheKey);

    res.json({
      status: 'success',
      message: 'Product removed from wishlist',
    });
  } catch (error) {
    console.error('Error in removeFromWishlist:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
      res.status(404).json({
        status: 'error',
        message: 'Product not found in wishlist',
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove from wishlist',
    });
  }
};
