import { prisma } from '../config/db';
import { Order, OrderStatus } from '@prisma/client';
import { deleteCache, deleteCachePattern } from './cache.service';
import { notifyOrderStatusChanged } from './googleSheets.service';
import { logger } from '../utils/logger';

const CACHE_KEYS = {
  USER_ORDERS: (userId: string) => `orders:user:${userId}:*`,
  ORDER_DETAILS: (id: string) => `orders:${id}`,
  ALL_ORDERS: () => `orders:all:*`,
};

export interface OrderStatusUpdateInput {
  status: OrderStatus;
  note?: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
  updatedBy?: string;
}

/**
 * Shared by the admin dashboard endpoint and the Google Sheets sync job so
 * both paths go through the same DB update, cache invalidation, and sheet
 * mirroring logic.
 */
export async function updateOrderStatusById(
  orderId: string,
  input: OrderStatusUpdateInput
): Promise<Order> {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: input.status,
      trackingNumber: input.trackingNumber,
      estimatedDelivery: input.estimatedDelivery,
      statusHistory: {
        create: {
          status: input.status,
          note: input.note,
          updatedBy: input.updatedBy,
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

  await Promise.all([
    deleteCache(CACHE_KEYS.ORDER_DETAILS(orderId)),
    deleteCachePattern(CACHE_KEYS.USER_ORDERS(order.userId)),
    deleteCachePattern(CACHE_KEYS.ALL_ORDERS()),
  ]);

  notifyOrderStatusChanged(order).catch((err) =>
    logger.warn({ err, orderId }, 'Failed to sync order status change to Google Sheets')
  );

  return order;
}

export async function findOrderByOrderNumber(orderNumber: string): Promise<Order | null> {
  return prisma.order.findUnique({ where: { orderNumber } });
}
