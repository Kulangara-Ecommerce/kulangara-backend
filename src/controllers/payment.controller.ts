import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';
import { PaymentStatus } from '@prisma/client';
import { razorpay } from '../config/razorpay';
import redis from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getHeaderString } from '../utils/typeGuards';
import { ICreateRazorpayOrderRequest, IVerifyPaymentWithCartRequest } from '../types/payment.types';
import {
  createPendingOrderFromCart,
  confirmOrderPaymentByRazorpayOrderId,
  failOrderPaymentByRazorpayOrderId,
  findOrderByRazorpayOrderId,
} from '../services/orderPayment.service';

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

    // Persist the link so the webhook and reconciliation job can find this
    // order purely from the Razorpay order id, same as the cart-checkout flow.
    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: razorpayOrder.id },
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
        // Use variant price if set, otherwise fall back to product price
        const effectiveVariantPrice = variant.price ?? variant.product.price;
        if (Math.abs(effectiveVariantPrice - item.price) > 0.01) {
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
        // Use discounted price if available, otherwise base price
        const effectiveProductPrice = product.discountedPrice ?? product.price;
        if (Math.abs(effectiveProductPrice - item.price) > 0.01) {
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

    // Create the DB order now, PENDING, before the customer has paid. This is
    // what lets the webhook and the reconciliation job recover this order
    // even if the client never comes back after payment (closed tab, network
    // drop, etc.) — there is always a row to update instead of relying on a
    // short-lived cache entry that may already be gone by the time anything
    // tries to read it.
    try {
      await createPendingOrderFromCart({
        razorpayOrderId: razorpayOrder.id,
        userId,
        cartData,
      });
    } catch (creationError) {
      const message = creationError instanceof Error ? creationError.message : '';
      logger.error(
        { err: creationError, razorpayOrderId: razorpayOrder.id },
        'Failed to create pending order for cart checkout'
      );
      if (
        message.includes('Insufficient stock') ||
        message.includes('not found') ||
        message.includes('Stock reservation failed')
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
        message: 'Failed to create payment order',
      });
      return;
    }

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

    const updated = await confirmOrderPaymentByRazorpayOrderId(
      razorpay_order_id,
      razorpay_payment_id
    );

    if (!updated) {
      res.status(404).json({
        status: 'error',
        message: 'Order not found for this payment',
      });
      return;
    }

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
    }: IVerifyPaymentWithCartRequest = req.body;

    const userId = req.user!.id;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({ status: 'error', message: 'Invalid payment signature' });
      return;
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    // Accept both 'captured' (auto-capture) and 'authorized' (manual capture / some UPI flows)
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      res.status(400).json({ status: 'error', message: 'Payment not captured' });
      return;
    }

    // The order was already created (PENDING) when the Razorpay order was
    // created, before checkout even opened — see createRazorpayOrderFromCart.
    const order = await findOrderByRazorpayOrderId(razorpay_order_id);
    if (!order) {
      res.status(404).json({
        status: 'error',
        message:
          'Order not found. If your payment was captured, it will be confirmed automatically shortly.',
      });
      return;
    }

    if (order.userId !== userId) {
      res.status(403).json({ status: 'error', message: 'User mismatch' });
      return;
    }

    const result = await confirmOrderPaymentByRazorpayOrderId(
      razorpay_order_id,
      razorpay_payment_id
    );

    res.json({
      status: 'success',
      message: 'Payment verified and order created successfully',
      data: {
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: result!.id,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, endpoint: 'verifyPaymentAndCreateOrder' },
      'Error in verifyPaymentAndCreateOrder'
    );

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

// Both the legacy (pre-created order) and cart-checkout flows now persist
// razorpayOrderId on the order as soon as the Razorpay order is created, so
// the webhook can find and confirm/fail the order without needing anything
// from `payment.notes` or Redis.
async function handlePaymentCaptured(payment: any) {
  const updated = await confirmOrderPaymentByRazorpayOrderId(payment.order_id, payment.id);

  if (!updated) {
    // Either the order hasn't been created yet (shouldn't happen — the order
    // row is written synchronously before checkout ever opens) or this
    // razorpayOrderId doesn't belong to us. Log loudly so it's not silently lost.
    logger.error(
      { razorpayOrderId: payment.order_id, paymentId: payment.id },
      'Webhook: payment.captured for a Razorpay order with no matching DB order'
    );
  }
}

async function handlePaymentFailed(payment: any) {
  const updated = await failOrderPaymentByRazorpayOrderId(payment.order_id, 'Payment failed');

  if (!updated) {
    logger.warn(
      { razorpayOrderId: payment.order_id, paymentId: payment.id },
      'Webhook: payment.failed for a Razorpay order with no matching DB order'
    );
  }
}

async function handleRefundProcessed(refund: any) {
  const orderId = refund.notes?.orderId;

  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId } })
    : await prisma.order.findFirst({ where: { paymentId: refund.payment_id } });

  if (!order) {
    logger.warn({ refundId: refund.id }, 'Webhook: refund.processed for an unknown order');
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
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
