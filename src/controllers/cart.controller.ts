import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { ICartItemCreate, ICartItemUpdate } from '../types/cart.types';
// import { ObjectId } from 'bson';
import createError from 'http-errors';
import { cacheWrapper, deleteCache } from '../services/cache.service';

// Cache keys
const CACHE_KEYS = {
  CART: (userId: string) => `cart:${userId}`,
};

const CART_ITEM_INCLUDE = {
  product: {
    select: {
      name: true,
      slug: true,
      images: {
        where: { isPrimary: true },
        take: 1,
        select: { url: true, isPrimary: true },
      },
    },
  },
  variant: {
    select: {
      size: true,
      color: true,
      sku: true,
    },
  },
};

// Validate MongoDB ObjectId
// const isValidObjectId = (id: string): boolean => {
//   try {
//     return ObjectId.isValid(id);
//   } catch {
//     return false;
//   }
// };

// Utility function to recalculate cart totals
const recalculateCartTotals = async (cartId: string) => {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
  });

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { subtotal, total: subtotal }; // Add any additional calculations (tax, shipping, etc.) here
};

// Get cart
export const getCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const cacheKey = CACHE_KEYS.CART(userId);

    const cart = await cacheWrapper(
      cacheKey,
      async () => {
        // Get from database
        let cart = await prisma.cart.findUnique({
          where: { userId },
          include: {
            items: {
              include: CART_ITEM_INCLUDE,
            },
          },
        });

        if (!cart) {
          // Create empty cart if not exists
          cart = await prisma.cart.create({
            data: {
              userId,
              subtotal: 0,
              total: 0,
            },
            include: {
              items: {
                include: CART_ITEM_INCLUDE,
              },
            },
          });
        }

        return cart;
      },
      300 // Cache for 5 minutes
    );

    res.json({
      status: 'success',
      data: cart,
    });
  } catch (error) {
    console.error('Error in getCart:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch cart',
    });
  }
};

// Add item to cart
export const addCartItem = async (
  req: Request<{}, {}, ICartItemCreate>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { productId, variantId, quantity } = req.body;

    if (!productId) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid product ID',
      });
      return;
    }

    if (variantId !== undefined && !variantId) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid variant ID',
      });
      return;
    }

    const updatedCart = await prisma.$transaction(async (prismaClient) => {
      // Get or create cart
      let cart = await prismaClient.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      if (!cart) {
        cart = await prismaClient.cart.create({
          data: {
            userId,
            subtotal: 0,
            total: 0,
          },
          include: { items: true },
        });
      }

      // Get product price
      const product = await prismaClient.product.findUnique({
        where: { id: productId },
        select: { price: true, discountedPrice: true },
      });

      if (!product) {
        res.status(404).json({
          status: 'error',
          message: 'Product not found',
        });
        return;
      }

      // Get variant price if applicable
      let finalPrice = product.discountedPrice ?? product.price;
      if (variantId) {
        const variant = await prismaClient.productVariant.findUnique({
          where: { id: variantId },
          select: { price: true },
        });
        if (!variant) {
          res.status(404).json({
            status: 'error',
            message: 'Variant not found',
          });
          return;
        }
        finalPrice = variant.price ?? product.price;
      }

      // Check if item already exists in cart
      const existingItem = cart.items.find(
        (item) => item.productId === productId && item.variantId === variantId
      );

      if (existingItem) {
        // Update existing item
        await prismaClient.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: existingItem.quantity + quantity,
            price: finalPrice,
            subtotal: finalPrice * (existingItem.quantity + quantity),
          },
        });
      } else {
        // Create new item
        await prismaClient.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            variantId,
            quantity,
            price: finalPrice,
            subtotal: finalPrice * quantity,
          },
        });
      }

      // Recalculate cart totals
      const { subtotal, total } = await recalculateCartTotals(cart.id);

      // Update cart with new totals
      return await prismaClient.cart.update({
        where: { id: cart.id },
        data: { subtotal, total },
        include: {
          items: {
            include: CART_ITEM_INCLUDE,
          },
        },
      });
    });

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CART(userId));

    res.status(201).json({
      status: 'success',
      message: 'Item added to cart',
      data: updatedCart,
    });
  } catch (error) {
    console.error('Error in addCartItem:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to add item to cart',
    });
  }
};

// Update cart item
export const updateCartItem = async (
  req: Request<{ id: string }, {}, ICartItemUpdate>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { quantity } = req.body;

    if (!id) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid item ID',
      });
      return;
    }

    const updatedCart = await prisma.$transaction(async (prismaClient) => {
      // Get cart item
      const cartItem = await prismaClient.cartItem.findFirst({
        where: {
          id,
          cart: { userId },
        },
      });

      if (!cartItem) {
        res.status(404).json({
          status: 'error',
          message: 'Cart item not found',
        });
        return;
      }

      // Update cart item
      await prismaClient.cartItem.update({
        where: { id },
        data: {
          quantity,
          subtotal: cartItem.price * quantity,
        },
      });

      // Recalculate and update cart totals
      const { subtotal, total } = await recalculateCartTotals(cartItem.cartId);

      return await prismaClient.cart.update({
        where: { userId },
        data: { subtotal, total },
        include: {
          items: {
            include: CART_ITEM_INCLUDE,
          },
        },
      });
    });

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CART(userId));

    res.json({
      status: 'success',
      message: 'Cart item updated',
      data: updatedCart,
    });
  } catch (error) {
    console.error('Error in updateCartItem:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to update cart item',
    });
  }
};

// Remove cart item
export const removeCartItem = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid item ID',
      });
      return;
    }

    const updatedCart = await prisma.$transaction(async (prismaClient) => {
      // Get cart item
      const cartItem = await prismaClient.cartItem.findFirst({
        where: {
          id,
          cart: { userId },
        },
      });

      if (!cartItem) {
        res.status(404).json({
          status: 'error',
          message: 'Cart item not found',
        });
        return;
      }

      // Delete cart item
      await prismaClient.cartItem.delete({
        where: { id },
      });

      // Recalculate and update cart totals
      const { subtotal, total } = await recalculateCartTotals(cartItem.cartId);

      return await prismaClient.cart.update({
        where: { userId },
        data: { subtotal, total },
        include: {
          items: {
            include: CART_ITEM_INCLUDE,
          },
        },
      });
    });

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CART(userId));

    res.json({
      status: 'success',
      message: 'Cart item removed',
      data: updatedCart,
    });
  } catch (error) {
    console.error('Error in removeCartItem:', error);
    if (error instanceof createError.HttpError) {
      res.status(error.status).json({
        status: 'error',
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove cart item',
    });
  }
};

// Clear cart
export const clearCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      await deleteCache(CACHE_KEYS.CART(userId));

      res.json({
        status: 'success',
        message: 'Cart is already empty',
        data: {
          items: [],
          subtotal: 0,
          total: 0,
        },
      });
      return;
    }

    const updatedCart = await prisma.$transaction(async (prismaClient) => {
      await prismaClient.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      return await prismaClient.cart.update({
        where: { userId },
        data: {
          subtotal: 0,
          total: 0,
        },
        include: {
          items: true,
        },
      });
    });

    await deleteCache(CACHE_KEYS.CART(userId));

    res.json({
      status: 'success',
      message: 'Cart cleared',
      data: updatedCart,
    });
  } catch (error) {
    console.error('Error in clearCart:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to clear cart',
    });
  }
};
