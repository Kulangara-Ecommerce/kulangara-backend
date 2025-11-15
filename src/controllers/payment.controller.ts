import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';
import { PaymentStatus, OrderStatus } from '@prisma/client';
import { razorpay } from '../config/razorpay';
import redis from '../config/redis';
import { reserveStock, StockItem } from '../services/stock.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getHeaderString } from '../utils/typeGuards';
import {
  ICreateRazorpayOrderRequest,
  IVerifyPaymentWithCartRequest,
  ITemporaryOrderData,
} from '../types/payment.types';

export const createRazorpayOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.body;

    // Get order details from database
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
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

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.totalAmount * 100), // Convert to smallest currency unit (paise)
      currency: 'INR',
      receipt: order.orderNumber,
      notes: {
        orderId: order.id,
      },
    });

    res.json({
      status: 'success',
      data: {
        orderId: razorpayOrder.id,
        currency: razorpayOrder.currency,
        amount: razorpayOrder.amount,
        key: env.RAZORPAY_KEY_ID,
        name: env.BUSINESS_NAME || 'Kulangara',
        description: `Order #${order.orderNumber}`,
        prefill: {
          name: `${order.user.firstName} ${order.user.lastName}`,
          email: order.user.email,
          contact: order.user.phone,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'createRazorpayOrder' }, 'Error in createRazorpayOrder');
    res.status(500).json({
      status: 'error',
      message: 'Failed to create payment order',
    });
  }
};

// Create Razorpay order from cart data (without creating database order)
export const createRazorpayOrderFromCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const { cartData, userEmail, userPhone }: ICreateRazorpayOrderRequest = req.body;
    const userId = req.user!.id;

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
      return;
    }

    const shippingAddress = await prisma.address.findFirst({
      where: {
        id: cartData.shippingAddressId,
        userId: userId,
      },
    });

    if (!shippingAddress) {
      res.status(404).json({
        status: 'error',
        message: 'Shipping address not found',
      });
      return;
    }

    let calculatedSubtotal = 0;
    for (const item of cartData.items) {
      if (item.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: true },
        });
        if (!variant || variant.product.id !== item.productId) {
          res.status(400).json({
            status: 'error',
            message: `Invalid product variant: ${item.variantId}`,
          });
          return;
        }
        if (variant.price !== item.price) {
          res.status(400).json({
            status: 'error',
            message: `Price mismatch for variant: ${item.variantId}`,
          });
          return;
        }
      } else {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
        });
        if (!product) {
          res.status(400).json({
            status: 'error',
            message: `Product not found: ${item.productId}`,
          });
          return;
        }
        if (product.price !== item.price) {
          res.status(400).json({
            status: 'error',
            message: `Price mismatch for product: ${item.productId}`,
          });
          return;
        }
      }
      calculatedSubtotal += item.price * item.quantity;
    }

    if (Math.abs(calculatedSubtotal - cartData.subtotal) > 0.01) {
      res.status(400).json({
        status: 'error',
        message: 'Subtotal calculation mismatch',
      });
      return;
    }

    const receiptId = `CART_${Date.now()}_${userId.slice(-6)}`;

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(cartData.total * 100),
      currency: 'INR',
      receipt: receiptId,
      notes: {
        userId: userId,
        type: 'cart_payment',
        itemCount: cartData.items.length.toString(),
      },
    });

    const tempOrderData: ITemporaryOrderData = {
      razorpayOrderId: razorpayOrder.id,
      cartData,
      userId,
      userEmail: userEmail || user.email,
      userPhone: userPhone || user.phone || '',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    };

    await redis.setex(`temp_order:${razorpayOrder.id}`, 3600, JSON.stringify(tempOrderData));

    res.json({
      status: 'success',
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: env.RAZORPAY_KEY_ID,
        name: env.BUSINESS_NAME || 'Kulangara',
        description: `Order for ${cartData.items.length} item(s)`,
        prefill: {
          email: userEmail || user.email,
          contact: userPhone || user.phone || '',
        },
        theme: {
          color: '#3B82F6',
        },
      },
    });
  } catch (error) {
    logger.error(
      { err: error, endpoint: 'createRazorpayOrderFromCart' },
      'Error in createRazorpayOrderFromCart'
    );
    res.status(500).json({
      status: 'error',
      message: 'Failed to create payment order',
    });
  }
};

export const verifyPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid payment signature',
      });
      return;
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    const orderId = payment.notes?.orderId;

    if (!orderId) {
      res.status(400).json({
        status: 'error',
        message: 'Order ID not found in payment',
      });
      return;
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paymentId: razorpay_payment_id,
        status: 'CONFIRMED',
        statusHistory: {
          create: {
            status: 'CONFIRMED',
            note: 'Payment received and verified',
          },
        },
      },
    });

    res.json({
      status: 'success',
      message: 'Payment verified successfully',
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'verifyPayment' }, 'Error in verifyPayment');
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify payment',
    });
  }
};

export const verifyPaymentAndCreateOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      cartData,
    }: IVerifyPaymentWithCartRequest = req.body;

    const userId = req.user!.id;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid payment signature',
      });
      return;
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.status !== 'captured') {
      res.status(400).json({
        status: 'error',
        message: 'Payment not captured',
      });
      return;
    }

    const tempOrderDataString = await redis.get(`temp_order:${razorpay_order_id}`);
    if (!tempOrderDataString) {
      res.status(400).json({
        status: 'error',
        message: 'Order session expired or not found',
      });
      return;
    }

    const tempOrderData: ITemporaryOrderData = JSON.parse(tempOrderDataString);

    if (tempOrderData.userId !== userId) {
      res.status(400).json({
        status: 'error',
        message: 'User mismatch',
      });
      return;
    }

    const generateOrderNumber = (): string => {
      const timestamp = Date.now().toString().slice(-8);
      const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0');
      return `KGR${timestamp}${random}`;
    };

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
          addedDays++;
        }
      }
      return date;
    };

    let discountAmount = tempOrderData.cartData.discount;
    let appliedCouponId = null;

    if (cartData.couponCode && tempOrderData.cartData.couponCode) {
      const coupon = await prisma.coupon.findFirst({
        where: {
          code: cartData.couponCode,
          isActive: true,
          validFrom: { lte: new Date() },
          validUntil: { gte: new Date() },
        },
      });

      if (!coupon) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid or expired coupon',
        });
        return;
      }

      appliedCouponId = coupon.id;
    }

    const result = await prisma.$transaction(async (tx) => {
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

      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: userId,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: cartData.paymentMethod,
          paymentId: razorpay_payment_id,
          shippingAddressId: cartData.shippingAddressId,
          subtotal: tempOrderData.cartData.subtotal,
          discountAmount: discountAmount,
          totalAmount: tempOrderData.cartData.total,
          couponId: appliedCouponId,
          trackingNumber: generateTrackingNumber(),
          estimatedDelivery: getEstimatedDeliveryDate(),
        },
      });

      // Create order items using the reserved items with correct prices
      for (const item of reservedItems) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price,
          },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CONFIRMED,
          note: 'Order confirmed after successful payment',
        },
      });

      await tx.cartItem.deleteMany({
        where: {
          cart: {
            userId: userId,
          },
        },
      });

      await tx.cart.updateMany({
        where: { userId: userId },
        data: {
          subtotal: 0,
          total: 0,
        },
      });

      if (appliedCouponId) {
        await tx.coupon.update({
          where: { id: appliedCouponId },
          data: {
            usageCount: { increment: 1 },
          },
        });
      }

      return order;
    });

    await redis.del(`temp_order:${razorpay_order_id}`);

    res.json({
      status: 'success',
      message: 'Payment verified and order created successfully',
      data: {
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: result.id,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, endpoint: 'verifyPaymentAndCreateOrder' },
      'Error in verifyPaymentAndCreateOrder'
    );

    // Handle stock-related errors with specific messages
    const errorMessage = error instanceof Error ? error.message : '';
    if (errorMessage && errorMessage.includes('Stock reservation failed')) {
      res.status(400).json({
        status: 'error',
        message: errorMessage,
      });
      return;
    }

    if (
      errorMessage &&
      (errorMessage.includes('Insufficient stock') || errorMessage.includes('not found'))
    ) {
      res.status(400).json({
        status: 'error',
        message:
          'Some items in your cart are no longer available or out of stock. Please review your cart and try again.',
      });
      return;
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to verify payment and create order',
    });
  }
};

export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    const signature = getHeaderString(req.headers, 'x-razorpay-signature');

    if (!webhookSecret || !signature) {
      res.status(400).json({
        status: 'error',
        message: 'Missing webhook secret or signature',
      });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body)
      .digest('hex');

    if (expectedSignature !== signature) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid webhook signature',
      });
      return;
    }

    const event = JSON.parse(req.body.toString());

    // Idempotency check: Use event ID to prevent duplicate processing
    const eventId =
      event.id || event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.id;

    if (eventId) {
      const idempotencyKey = `webhook:${eventId}`;
      const alreadyProcessed = await redis.get(idempotencyKey);

      if (alreadyProcessed) {
        // Event already processed, return success without reprocessing
        logger.info(
          { eventId, event: event.event },
          'Webhook event already processed (idempotency)'
        );
        res.json({ status: 'success', message: 'Event already processed' });
        return;
      }

      // Mark event as being processed (TTL: 24 hours)
      await redis.set(idempotencyKey, '1', 'EX', 24 * 60 * 60);
    }

    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;
      case 'refund.processed':
        await handleRefundProcessed(event.payload.refund.entity);
        break;
    }

    res.json({ status: 'success' });
  } catch (error) {
    logger.error({ err: error, endpoint: 'handleWebhook' }, 'Error in handleWebhook');
    res.status(500).json({
      status: 'error',
      message: 'Failed to process webhook',
    });
  }
};

async function handlePaymentCaptured(payment: any) {
  const orderId = payment.notes?.orderId;
  if (!orderId) return;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: PaymentStatus.PAID,
      paymentId: payment.id,
      status: 'CONFIRMED',
      statusHistory: {
        create: {
          status: 'CONFIRMED',
          note: 'Payment captured successfully',
        },
      },
    },
  });
}

async function handlePaymentFailed(payment: any) {
  const orderId = payment.notes?.orderId;
  if (!orderId) return;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: PaymentStatus.FAILED,
      paymentId: payment.id,
      status: 'CANCELLED',
      statusHistory: {
        create: {
          status: 'CANCELLED',
          note: 'Payment failed',
        },
      },
    },
  });
}

async function handleRefundProcessed(refund: any) {
  const orderId = refund.notes?.orderId;
  if (!orderId) return;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: PaymentStatus.REFUNDED,
      status: 'REFUNDED',
      statusHistory: {
        create: {
          status: 'REFUNDED',
          note: `Refund processed: ${refund.id}`,
        },
      },
    },
  });
}

export const updatePaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: orderId } = req.params;
    const { paymentStatus, note } = req.body;

    // Check if order exists
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        paymentStatus: true,
        status: true,
      },
    });

    if (!existingOrder) {
      res.status(404).json({
        status: 'error',
        message: 'Order not found',
      });
      return;
    }

    // Update payment status
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: paymentStatus,
        statusHistory: {
          create: {
            status: existingOrder.status,
            note: note || `Payment status updated to ${paymentStatus}`,
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

    res.json({
      status: 'success',
      message: 'Payment status updated successfully',
      data: {
        orderId: updatedOrder.id,
        paymentStatus: updatedOrder.paymentStatus,
        lastUpdate: updatedOrder.statusHistory[0],
      },
    });
  } catch (error) {
    logger.error({ err: error, endpoint: 'updatePaymentStatus' }, 'Error in updatePaymentStatus');
    res.status(500).json({
      status: 'error',
      message: 'Failed to update payment status',
    });
  }
};

export const cleanupExpiredTemporaryOrders = async (): Promise<void> => {
  try {
    logger.debug('Cleanup function called - Redis keys auto-expire after 1 hour');
  } catch (error) {
    logger.error({ err: error }, 'Error cleaning up expired temporary orders');
  }
};
