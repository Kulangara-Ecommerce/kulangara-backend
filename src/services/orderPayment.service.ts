import crypto from 'crypto';
import { prisma } from '../config/db';
import { Order, OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { reserveStock, restoreStock, StockItem } from './stock.service';
import { deleteCachePattern } from './cache.service';
import { logger } from '../utils/logger';
import { notifyOrderCreated, notifyOrderStatusChanged } from './googleSheets.service';

export interface CartCheckoutData {
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  couponCode?: string;
  shippingAddressId: string;
}

export const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `KGR${timestamp}${random}`;
};

export const generateTrackingNumber = (): string => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = 'KGR';
  const randomBytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) {
    result += chars[randomBytes[i]! % chars.length];
  }
  return result;
};

export const getEstimatedDeliveryDate = (workingDays = 5): Date => {
  const date = new Date();
  let addedDays = 0;
  while (addedDays < workingDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      addedDays++;
    }
  }
  return date;
};

/**
 * Creates the database order the moment a Razorpay order is created — BEFORE
 * the customer pays. This is the fix for orders that existed at Razorpay but
 * never made it into the DB: there is now always a PENDING row to fall back
 * to (and for the reconciliation job to sweep) even if the client never
 * comes back and the webhook is delayed or lost.
 */
export async function createPendingOrderFromCart(input: {
  razorpayOrderId: string;
  userId: string;
  cartData: CartCheckoutData;
}): Promise<Order> {
  const { razorpayOrderId, userId, cartData } = input;

  let appliedCouponId: string | null = null;
  if (cartData.couponCode) {
    const coupon = await prisma.coupon.findFirst({
      where: {
        code: cartData.couponCode,
        isActive: true,
        validFrom: { lte: new Date() },
        validUntil: { gte: new Date() },
      },
    });
    if (coupon) {
      appliedCouponId = coupon.id;
    }
  }

  const order = await prisma.$transaction(async (tx) => {
    const stockItems: StockItem[] = cartData.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
    }));

    const stockReservation = await reserveStock(stockItems, tx);
    if (!stockReservation.success) {
      throw new Error(stockReservation.message || 'Failed to reserve stock');
    }

    const reservedItems = stockReservation.reservedItems!;

    const createdOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        paymentMethod: 'RAZORPAY',
        razorpayOrderId,
        shippingAddressId: cartData.shippingAddressId,
        subtotal: cartData.subtotal,
        discountAmount: cartData.discount,
        totalAmount: cartData.total,
        couponId: appliedCouponId,
        trackingNumber: generateTrackingNumber(),
        estimatedDelivery: getEstimatedDeliveryDate(),
      },
    });

    for (const item of reservedItems) {
      let size: string | undefined;
      let fit: string | undefined;
      if (item.variantId) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { size: true, fit: true },
        });
        if (variant) {
          size = variant.size;
          fit = variant.fit ?? undefined;
        }
      }

      await tx.orderItem.create({
        data: {
          orderId: createdOrder.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
          size,
          fit,
        },
      });
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: createdOrder.id,
        status: OrderStatus.PENDING,
        note: 'Order created, awaiting payment',
      },
    });

    return createdOrder;
  });

  await deleteCachePattern('orders:all:*');

  notifyOrderCreated(order).catch((err) =>
    logger.warn({ err, orderId: order.id }, 'Failed to sync new order to Google Sheets')
  );

  return order;
}

/** How long a PENDING checkout can be reused. Must stay below the reconciliation threshold (45 min). */
export const REUSABLE_PENDING_ORDER_WINDOW_MINUTES = 30;

/**
 * Looks for an unpaid checkout the same user started moments ago with the exact
 * same cart, address and total. A double-click or client retry would otherwise
 * create a second Razorpay order + DB order and reserve the stock twice, so the
 * caller reuses this one instead.
 */
export async function findReusablePendingOrder(
  userId: string,
  cartData: CartCheckoutData
): Promise<{ razorpayOrderId: string; totalAmount: number } | null> {
  const since = new Date(Date.now() - REUSABLE_PENDING_ORDER_WINDOW_MINUTES * 60 * 1000);

  const candidates = await prisma.order.findMany({
    where: {
      userId,
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: 'RAZORPAY',
      razorpayOrderId: { not: null },
      shippingAddressId: cartData.shippingAddressId,
      totalAmount: cartData.total,
      createdAt: { gte: since },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  const signature = (
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>
  ): string =>
    items
      .map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`)
      .sort()
      .join('|');
  const wanted = signature(cartData.items);

  const match = candidates.find((o) => signature(o.items) === wanted);
  return match && match.razorpayOrderId
    ? { razorpayOrderId: match.razorpayOrderId, totalAmount: match.totalAmount }
    : null;
}

export async function findOrderByRazorpayOrderId(razorpayOrderId: string): Promise<Order | null> {
  return prisma.order.findUnique({ where: { razorpayOrderId } });
}

/**
 * Idempotently marks an order as paid/confirmed. Safe to call twice for the
 * same order (client-side verify call and the webhook both call this for
 * every successful payment) — only the first caller performs the side
 * effects (cart clear, coupon usage increment, status history entry).
 */
export async function confirmOrderPaymentByRazorpayOrderId(
  razorpayOrderId: string,
  paymentId: string
): Promise<Order | null> {
  const order = await prisma.order.findUnique({ where: { razorpayOrderId } });
  if (!order) {
    return null;
  }

  if (order.paymentStatus === PaymentStatus.PAID) {
    return order;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: { not: PaymentStatus.PAID } },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paymentId,
        status: OrderStatus.CONFIRMED,
      },
    });

    if (count === 0) {
      // Another concurrent call (webhook vs. client verify) already confirmed it.
      return null;
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: OrderStatus.CONFIRMED,
        note: 'Payment received and verified',
      },
    });

    await tx.cartItem.deleteMany({ where: { cart: { userId: order.userId } } });
    await tx.cart.updateMany({ where: { userId: order.userId }, data: { subtotal: 0, total: 0 } });

    if (order.couponId) {
      await tx.coupon.update({
        where: { id: order.couponId },
        data: { usageCount: { increment: 1 } },
      });
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });

  const result = updated ?? (await prisma.order.findUnique({ where: { id: order.id } }));

  await Promise.all([
    deleteCachePattern(`orders:user:${order.userId}:*`),
    deleteCachePattern('orders:all:*'),
  ]);

  if (result && updated) {
    notifyOrderStatusChanged(result).catch((err) =>
      logger.warn({ err, orderId: result.id }, 'Failed to sync order confirmation to Google Sheets')
    );
  }

  return result;
}

/**
 * Idempotently marks an order as failed/cancelled and releases the stock
 * that was reserved for it at creation time. Safe to call more than once.
 *
 * `abandoned` is for checkouts where the customer never attempted a payment:
 * the order is CANCELLED but paymentStatus stays PENDING, so FAILED is kept
 * for payments that were really attempted and went wrong.
 */
export async function failOrderPaymentByRazorpayOrderId(
  razorpayOrderId: string,
  reason: string,
  options: { abandoned?: boolean } = {}
): Promise<Order | null> {
  const order = await prisma.order.findUnique({
    where: { razorpayOrderId },
    include: { items: true },
  });
  if (!order) {
    return null;
  }

  if (order.status === OrderStatus.CANCELLED || order.paymentStatus === PaymentStatus.PAID) {
    // Already terminal, or already paid — never fail a paid order out from under it.
    return order;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: {
        id: order.id,
        status: { not: OrderStatus.CANCELLED },
        paymentStatus: { not: PaymentStatus.PAID },
      },
      data: {
        status: OrderStatus.CANCELLED,
        paymentStatus: options.abandoned ? PaymentStatus.PENDING : PaymentStatus.FAILED,
      },
    });

    if (count === 0) {
      return null;
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: OrderStatus.CANCELLED,
        note: reason,
      },
    });

    await restoreStock(
      order.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity: item.quantity,
      })),
      tx as Prisma.TransactionClient
    );

    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });

  const result = updated ?? (await prisma.order.findUnique({ where: { id: order.id } }));

  await Promise.all([
    deleteCachePattern(`orders:user:${order.userId}:*`),
    deleteCachePattern('orders:all:*'),
  ]);

  if (result && updated) {
    notifyOrderStatusChanged(result).catch((err) =>
      logger.warn({ err, orderId: result.id }, 'Failed to sync order failure to Google Sheets')
    );
  }

  return result;
}
