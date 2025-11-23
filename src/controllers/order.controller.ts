import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { Prisma, OrderStatus, PaymentStatus, DiscountType } from '@prisma/client';
import { cacheWrapper, deleteCachePattern, deleteCache } from '../services/cache.service';
import { reserveStock, restoreStock, StockItem } from '../services/stock.service';
// import { ObjectId } from 'bson';
import {
  IOrderCreate,
  IOrderStatusUpdate,
  IOrderFilters,
} from '../types/order.types';
import { v4 as uuid } from 'uuid';

// Cache keys
const CACHE_KEYS = {
  USER_ORDERS: (userId: string, query: any) => `orders:user:${userId}:${JSON.stringify(query)}`,
  ORDER_DETAILS: (id: string) => `orders:${id}`,
  ALL_ORDERS: (query: any) => `orders:all:${JSON.stringify(query)}`,
};

// Validate MongoDB ObjectId
// const isValidObjectId = (id: string): boolean => {
//   try {
//     return ObjectId.isValid(id);
//   } catch {
//     return false;
//   }
// };

// Generate tracking number using crypto for better compatibility
const generateTrackingNumber = (): string => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = 'KGR';
  const randomBytes = require('crypto').randomBytes(10);
  for (let i = 0; i < 10; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
};

const getEstimatedDeliveryDate = (workingDays: number = 5): Date => {
  const date = new Date();
  let addedDays = 0;

  while (addedDays < workingDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      // Skip Sunday (0) and Saturday (6)
      addedDays++;
    }
  }

  return date;
};

// List user's orders
export const listOrders = async (
  req: Request<{}, {}, {}, IOrderFilters>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { page = 1, limit = 10, status } = req.query; //orders?page=1&limit=10&status=pending

    const normalizedQuery = {
      page: Number(page),
      limit: Number(limit),
      status: status ? String(status) : undefined,
    };

    const cacheKey = CACHE_KEYS.USER_ORDERS(userId, normalizedQuery);

    const result = await cacheWrapper(
      cacheKey,
      async () => {
        const where: Prisma.OrderWhereInput = {
          userId,
          status: normalizedQuery.status as OrderStatus,
        };

        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            include: {
              items: {
                include: {
                  product: {
                    select: {
                      name: true,
                      images: {
                        where: { isPrimary: true },
                        take: 1,
                      },
                    },
                  },
                  variant: true,
                },
              },
              shippingAddress: true,
            },
            skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
            take: normalizedQuery.limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.order.count({ where }),
        ]);

        return {
          data: orders,
          meta: {
            total,
            page: normalizedQuery.page,
            limit: normalizedQuery.limit,
            totalPages: Math.ceil(total / normalizedQuery.limit),
          },
        };
      },
      300 // Cache for 5 minutes
    );

    res.json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('Error in listOrders:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch orders',
    });
  }
};

// Get order by ID
export const getOrderById = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    if (!id) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid order ID format',
      });
      return;
    }

    const cacheKey = CACHE_KEYS.ORDER_DETAILS(id);

    const result = await cacheWrapper(
      cacheKey,
      async () => {
        const order = await prisma.order.findFirst({
          where: {
            id,
            userId, // Ensure user can only access their own orders
          },
          include: {
            items: {
              include: {
                product: {
                  select: {
                    name: true,
                    images: {
                      where: { isPrimary: true },
                      take: 1,
                    },
                  },
                },
                variant: true,
              },
            },
            shippingAddress: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (!order) {
          res.status(404).json({
            status: 'error',
            message: 'Order not found',
          });
          return;
        }

        return { data: order };
      },
      300 // Cache for 5 minutes
    );

    if (!result) {
      res.status(404).json({
        status: 'error',
        message: 'Order not found',
      });
      return;
    }

    res.json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('Error in getOrderById:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch order',
    });
  }
};

// Create order
export const createOrder = async (
  req: Request<{}, {}, IOrderCreate>,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { shippingAddressId, paymentMethod, items, couponCode } = req.body;

    // Start a transaction
    const order = await prisma.$transaction(async (prisma) => {
      // Validate coupon if provided
      let coupon;
      if (couponCode) {
        coupon = await prisma.coupon.findFirst({
          where: {
            code: couponCode,
            isActive: true,
            validFrom: { lte: new Date() },
            validUntil: { gte: new Date() },
          },
        });

        if (!coupon) {
          res.status(400).json({
            status: 'error',
            message: 'Invalid coupon code',
          });
          return;
        }
      }

      // Calculate order totals
      let subtotal = 0;
      const orderItems = [];

      const stockItems: StockItem[] = items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      }));

      // Reserve stock atomically
      const stockReservation = await reserveStock(stockItems, prisma);

      if (!stockReservation.success) {
        res.status(400).json({
          status: 'error',
          message: stockReservation.message || 'Failed to reserve stock',
        });
        return;
      }

      // Calculate totals using reserved items with correct prices
      for (const reservedItem of stockReservation.reservedItems!) {
        const itemSubtotal = reservedItem.price * reservedItem.quantity;
        subtotal += itemSubtotal;

        orderItems.push({
          productId: reservedItem.productId,
          variantId: reservedItem.variantId,
          quantity: reservedItem.quantity,
          price: reservedItem.price,
        });
      }

      // Calculate discounts
      let discountAmount = 0;
      if (coupon) {
        switch (coupon.type) {
          case DiscountType.PERCENTAGE:
            discountAmount = (subtotal * coupon.value) / 100;
            if (coupon.maxDiscount) {
              discountAmount = Math.min(discountAmount, coupon.maxDiscount);
            }
            break;
          case DiscountType.FIXED_AMOUNT:
            discountAmount = coupon.value;
            break;
          case DiscountType.FREE_SHIPPING:
            discountAmount = 0;
            break;
          default:
            discountAmount = 0;
            break;
        }
      }

      const isCOD =
        paymentMethod.toUpperCase() === 'COD' || paymentMethod.toUpperCase() === 'CASH_ON_DELIVERY';
      const orderStatus = isCOD ? OrderStatus.CONFIRMED : OrderStatus.PENDING;
      const paymentStatus = isCOD ? PaymentStatus.PENDING : PaymentStatus.PENDING; // COD payment is collected on delivery
      const statusNote = isCOD ? 'Order confirmed - Cash on Delivery' : 'Order created';

      // Create order
      const order = await prisma.order.create({
        data: {
          userId,
          orderNumber: uuid(),
          shippingAddressId,
          paymentMethod,
          status: orderStatus,
          paymentStatus: paymentStatus,
          subtotal,
          discountAmount,
          totalAmount: subtotal - discountAmount,
          couponId: coupon?.id,
          trackingNumber: generateTrackingNumber(),
          estimatedDelivery: getEstimatedDeliveryDate(),
          items: {
            createMany: {
              data: orderItems,
            },
          },
          statusHistory: {
            create: {
              status: orderStatus,
              note: statusNote,
            },
          },
        },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
          shippingAddress: true,
        },
      });

      // Update coupon usage if used
      if (coupon) {
        await prisma.coupon.update({
          where: { id: coupon.id },
          data: { usageCount: { increment: 1 } },
        });
      }

      // Clear user's cart after successful order
      await prisma.cart
        .delete({
          where: { userId },
        })
        .catch(() => {}); // Ignore if cart doesn't exist

      return order;
    });

    res.status(201).json({
      status: 'success',
      message: 'Order created successfully',
      data: { order },
    });
  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to create order',
    });
  }
};

// Cancel order
export const cancelOrder = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const order = await prisma.order.findFirst({
      where: {
        id,
        userId,
        status: {
          in: [OrderStatus.PENDING, OrderStatus.CONFIRMED],
        },
      },
      include: {
        items: true,
      },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        message: 'Order not found or cannot be cancelled',
      });
      return;
    }

    // Update order status and restore stock atomically
    await prisma.$transaction(async (tx) => {
      // Update order status
      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          statusHistory: {
            create: {
              status: OrderStatus.CANCELLED,
              note: 'Order cancelled by customer',
            },
          },
        },
      });

      // Restore stock using our service
      const stockItems: StockItem[] = order.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId || undefined,
        quantity: item.quantity,
      }));

      await restoreStock(stockItems, tx);

      // Restore coupon usage if applicable
      if (order.couponId) {
        await tx.coupon.update({
          where: { id: order.couponId },
          data: { usageCount: { decrement: 1 } },
        });
      }
    });

    // Invalidate caches
    await Promise.all([
      deleteCache(CACHE_KEYS.ORDER_DETAILS(id)),
      deleteCachePattern(`${CACHE_KEYS.USER_ORDERS(userId, '*')}`),
    ]);

    res.json({
      status: 'success',
      message: 'Order cancelled successfully',
    });
  } catch (error) {
    console.error('Error in cancelOrder:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to cancel order',
    });
  }
};

// Track order
export const trackOrder = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const order = await prisma.order.findFirst({
      where: {
        id,
        userId,
      },
      select: {
        status: true,
        trackingNumber: true,
        estimatedDelivery: true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        message: 'Order not found',
      });
      return;
    }

    res.json({
      status: 'success',
      data: {
        currentStatus: order.status,
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        history: order.statusHistory,
      },
    });
  } catch (error) {
    console.error('Error in trackOrder:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to track order',
    });
  }
};

// List all orders (Admin)
export const listAllOrders = async (
  req: Request<{}, {}, {}, IOrderFilters>,
  res: Response
): Promise<void> => {
  try {
    const { page = 1, limit = 10, status, startDate, endDate, search } = req.query;

    const normalizedQuery = {
      page: Number(page),
      limit: Number(limit),
      status: status ? String(status) : undefined,
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
      search: search ? String(search) : undefined,
    };

    const cacheKey = CACHE_KEYS.ALL_ORDERS(normalizedQuery);

    const result = await cacheWrapper(
      cacheKey,
      async () => {
        const where: Prisma.OrderWhereInput = {
          status: normalizedQuery.status as OrderStatus,
          createdAt: {
            gte: normalizedQuery.startDate,
            lte: normalizedQuery.endDate,
          },
          OR: normalizedQuery.search
            ? [
                { orderNumber: { contains: normalizedQuery.search, mode: 'insensitive' } },
                { user: { firstName: { contains: normalizedQuery.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: normalizedQuery.search, mode: 'insensitive' } } },
              ]
            : undefined,
        };

        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              items: {
                include: {
                  product: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              shippingAddress: true,
            },
            skip: (normalizedQuery.page - 1) * normalizedQuery.limit,
            take: normalizedQuery.limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.order.count({ where }),
        ]);

        return {
          data: orders,
          meta: {
            total,
            page: normalizedQuery.page,
            limit: normalizedQuery.limit,
            totalPages: Math.ceil(total / normalizedQuery.limit),
          },
        };
      },
      60 // Cache for 1 minute only for admin data
    );

    res.json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('Error in listAllOrders:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch orders',
    });
  }
};

// Update order status (Admin)
export const updateOrderStatus = async (
  req: Request<{ id: string }, {}, IOrderStatusUpdate>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, note, trackingNumber, estimatedDelivery } = req.body;
    const updatedBy = req.user!.id;

    if (estimatedDelivery && new Date(estimatedDelivery) < new Date()) {
      res.status(400).json({
        status: 'error',
        message: 'Estimated delivery cannot be in the past.',
      });
      return;
    }

    const order = await prisma.order.update({
      where: { id },
      data: {
        status,
        trackingNumber,
        estimatedDelivery,
        statusHistory: {
          create: {
            status,
            note,
            updatedBy,
          },
        },
      },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Invalidate caches
    await Promise.all([
      deleteCache(CACHE_KEYS.ORDER_DETAILS(id)),
      deleteCachePattern(`${CACHE_KEYS.USER_ORDERS(order.userId, '*')}`),
      deleteCachePattern(`${CACHE_KEYS.ALL_ORDERS('*')}`),
    ]);

    res.json({
      status: 'success',
      message: 'Order status updated successfully',
      data: { order },
    });
  } catch (error) {
    console.error('Error in updateOrderStatus:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({
          status: 'error',
          message: 'Order not found',
        });
        return;
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to update order status',
    });
  }
};
