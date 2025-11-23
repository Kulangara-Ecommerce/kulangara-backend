import { prisma } from '../config/db';
import { Prisma } from '@prisma/client';

export interface StockItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface StockReservationResult {
  success: boolean;
  message?: string;
  reservedItems?: Array<StockItem & { price: number; productName: string }>;
}

/**
 * Atomically reserve stock for multiple items
 * This ensures no overselling can occur even with concurrent requests
 */
export const reserveStock = async (
  items: StockItem[],
  prismaClient: Prisma.TransactionClient = prisma
): Promise<StockReservationResult> => {
  try {
    const reservedItems = [];

    for (const item of items) {
      let currentPrice = 0;
      let productName = '';

      if (item.variantId) {
        // Handle variant stock
        const variant = await prismaClient.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          return {
            success: false,
            message: `Product variant not found: ${item.variantId}`,
          };
        }

        currentPrice = variant.price || 0;
        productName = variant.product.name;

        // Atomically check and decrement stock
        const updatedVariant = await prismaClient.productVariant.update({
          where: {
            id: item.variantId,
            stock: { gte: item.quantity }, // Only update if sufficient stock
          },
          data: { stock: { decrement: item.quantity } },
        });

        if (!updatedVariant) {
          return {
            success: false,
            message: `Insufficient stock for product variant: ${productName} (${variant.size}${variant.color ? ` - ${variant.color}` : ''})`,
          };
        }
      } else {
        // Handle product stock
        const product = await prismaClient.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          return {
            success: false,
            message: `Product not found: ${item.productId}`,
          };
        }

        currentPrice = product.price;
        productName = product.name;

        // Atomically check and decrement stock
        const updatedProduct = await prismaClient.product.update({
          where: {
            id: item.productId,
            stockQuantity: { gte: item.quantity }, // Only update if sufficient stock
          },
          data: { stockQuantity: { decrement: item.quantity } },
        });

        if (!updatedProduct) {
          return {
            success: false,
            message: `Insufficient stock for product: ${productName}`,
          };
        }
      }

      reservedItems.push({
        ...item,
        price: currentPrice,
        productName,
      });
    }

    return {
      success: true,
      reservedItems,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Stock reservation failed: ${errorMessage}`,
    };
  }
};

/**
 * Restore stock for cancelled orders
 * Used when orders are cancelled or failed
 */
export const restoreStock = async (
  items: StockItem[],
  prismaClient: Prisma.TransactionClient = prisma
): Promise<void> => {
  for (const item of items) {
    if (item.variantId) {
      await prismaClient.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
    } else {
      await prismaClient.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }
  }
};

/**
 * Check if items are in stock without reserving them
 * Useful for cart validation and pre-checkout checks
 */
export const checkStockAvailability = async (
  items: StockItem[]
): Promise<{ available: boolean; message?: string }> => {
  try {
    for (const item of items) {
      if (item.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          return {
            available: false,
            message: `Product variant not found: ${item.variantId}`,
          };
        }

        if (variant.stock < item.quantity) {
          return {
            available: false,
            message: `Insufficient stock for ${variant.product.name} (${variant.size}${variant.color ? ` - ${variant.color}` : ''}). Available: ${variant.stock}, Requested: ${item.quantity}`,
          };
        }
      } else {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          return {
            available: false,
            message: `Product not found: ${item.productId}`,
          };
        }

        if (product.stockQuantity < item.quantity) {
          return {
            available: false,
            message: `Insufficient stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`,
          };
        }
      }
    }

    return { available: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      available: false,
      message: `Error checking stock availability: ${errorMessage}`,
    };
  }
};

/**
 * Get low stock alerts for admin dashboard
 */
export const getLowStockItems = async () => {
  const [lowStockProducts, lowStockVariants] = await Promise.all([
    // Products with low stock
    prisma.product.findMany({
      where: {
        stockQuantity: {
          lte: prisma.product.fields.lowStockThreshold,
        },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stockQuantity: true,
        lowStockThreshold: true,
      },
    }),
    // Variants with low stock
    prisma.productVariant.findMany({
      where: {
        stock: {
          lte: 10, // Default threshold for variants
        },
        isActive: true,
        product: {
          isActive: true,
        },
      },
      include: {
        product: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    products: lowStockProducts,
    variants: lowStockVariants.map((variant) => ({
      id: variant.id,
      productName: variant.product.name,
      size: variant.size,
      color: variant.color,
      sku: variant.sku,
      stock: variant.stock,
    })),
  };
};
