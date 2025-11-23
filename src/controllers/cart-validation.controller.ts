import { Request, Response } from 'express';
import { checkStockAvailability, StockItem } from '../services/stock.service';

interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

interface ValidateCartRequest {
  items: CartItem[];
}

/**
 * Validate cart items for stock availability before checkout
 * This prevents users from proceeding to payment with out-of-stock items
 */
export const validateCartStock = async (
  req: Request<{}, {}, ValidateCartRequest>,
  res: Response
): Promise<void> => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        status: 'error',
        message: 'Cart items are required',
      });
      return;
    }

    // Convert cart items to stock items
    const stockItems: StockItem[] = items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
    }));

    // Check stock availability
    const stockCheck = await checkStockAvailability(stockItems);

    if (!stockCheck.available) {
      res.status(400).json({
        status: 'error',
        message: stockCheck.message || 'Some items are out of stock',
        available: false,
      });
      return;
    }

    res.json({
      status: 'success',
      message: 'All items are available',
      available: true,
    });
  } catch (error) {
    console.error('Error validating cart stock:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to validate cart stock',
    });
  }
};

/**
 * Get real-time stock information for specific products/variants
 */
export const getStockInfo = async (
  req: Request<{ productId?: string }, {}, {}, { productIds?: string; variantIds?: string }>,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const { productIds, variantIds } = req.query;

    let finalProductIds = productIds;
    if (productId) {
      finalProductIds = productId;
    }

    const stockInfo: any = {
      products: [],
      variants: [],
    };

    // Get product stock info
    if (finalProductIds) {
      const productIdArray = finalProductIds.split(',').filter(Boolean);

      if (productIdArray.length > 0) {
        const { prisma } = await import('../config/db');

        stockInfo.products = await prisma.product.findMany({
          where: {
            id: { in: productIdArray },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            stockQuantity: true,
            lowStockThreshold: true,
            variants: {
              where: { isActive: true },
              select: {
                id: true,
                size: true,
                color: true,
                stock: true,
                sku: true,
              },
            },
          },
        });
      }
    }

    // Get variant stock info
    if (variantIds) {
      const variantIdArray = variantIds.split(',').filter(Boolean);

      if (variantIdArray.length > 0) {
        const { prisma } = await import('../config/db');

        stockInfo.variants = await prisma.productVariant.findMany({
          where: {
            id: { in: variantIdArray },
            isActive: true,
          },
          select: {
            id: true,
            size: true,
            color: true,
            stock: true,
            product: {
              select: {
                name: true,
              },
            },
          },
        });
      }
    }

    res.json({
      status: 'success',
      data: stockInfo,
    });
  } catch (error) {
    console.error('Error getting stock info:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get stock information',
    });
  }
};

/**
 * Debug endpoint to check recent orders for a product
 */
export const getProductOrderHistory = async (
  req: Request<{ productId: string }>,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const { prisma } = await import('../config/db');

    const recentOrders = await prisma.orderItem.findMany({
      where: {
        productId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        variant: {
          select: {
            size: true,
            color: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      status: 'success',
      data: {
        productId,
        recentOrders: recentOrders.map((item) => ({
          orderId: item.order.id,
          orderNumber: item.order.orderNumber,
          orderStatus: item.order.status,
          quantity: item.quantity,
          variant: item.variant ? `${item.variant.size} - ${item.variant.color}` : 'No variant',
          customerName: `${item.order.user.firstName} ${item.order.user.lastName}`,
          orderDate: item.order.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error getting order history:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get order history',
    });
  }
};
