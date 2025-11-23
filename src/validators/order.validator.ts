import { z } from 'zod';
import { OrderStatus } from '@prisma/client';

export const createOrderSchema = z.object({
  body: z.object({
    shippingAddressId: z.string(),
    paymentMethod: z.string(),
    items: z.array(
      z.object({
        productId: z.string(),
        variantId: z.string().optional(),
        quantity: z.number().int().positive(),
      })
    ),
    couponCode: z.string().optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.REFUNDED,
    ]),
    note: z.string().optional(),
    trackingNumber: z.string().optional(),
    estimatedDelivery: z.string().datetime().optional(),
  }),
});
