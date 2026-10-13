import { OrderStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../config/db';
import { razorpay } from '../config/razorpay';
import {
  confirmOrderPaymentByRazorpayOrderId,
  failOrderPaymentByRazorpayOrderId,
} from './orderPayment.service';
import { logger } from '../utils/logger';

export const DEFAULT_RECONCILIATION_THRESHOLD_MINUTES = 45;

export interface ReconciliationResult {
  checked: number;
  confirmed: number;
  failed: number;
  skipped: number;
}

/**
 * Sweeps orders that have sat PENDING for longer than `thresholdMinutes` and
 * resolves them one way or another instead of leaving them (and the stock
 * reserved for them) in limbo forever. Before declaring an order failed, it
 * double-checks with Razorpay directly — a delayed or lost webhook should
 * never cause a real payment to be falsely cancelled.
 */
export async function reconcileStalePendingOrders(
  thresholdMinutes: number = DEFAULT_RECONCILIATION_THRESHOLD_MINUTES
): Promise<ReconciliationResult> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const staleOrders = await prisma.order.findMany({
    where: {
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: 'RAZORPAY',
      razorpayOrderId: { not: null },
      createdAt: { lt: cutoff },
    },
  });

  const result: ReconciliationResult = {
    checked: staleOrders.length,
    confirmed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const order of staleOrders) {
    if (!order.razorpayOrderId) {
      result.skipped++;
      continue;
    }

    try {
      const { capturedPaymentId, attempts } = await inspectPayments(order.razorpayOrderId);

      if (capturedPaymentId) {
        await confirmOrderPaymentByRazorpayOrderId(order.razorpayOrderId, capturedPaymentId);
        result.confirmed++;
        logger.info(
          { orderId: order.id, razorpayOrderId: order.razorpayOrderId },
          'Reconciliation: self-healed a stale order that Razorpay shows as paid'
        );
      } else {
        const abandoned = attempts === 0;
        await failOrderPaymentByRazorpayOrderId(
          order.razorpayOrderId,
          abandoned
            ? `Checkout abandoned: no payment attempted within ${thresholdMinutes} minutes`
            : `No successful payment found ${thresholdMinutes} minutes after order creation`,
          { abandoned }
        );
        result.failed++;
        logger.info(
          { orderId: order.id, razorpayOrderId: order.razorpayOrderId },
          'Reconciliation: marked stale unpaid order as failed and released its stock'
        );
      }
    } catch (err) {
      logger.error(
        { err, orderId: order.id, razorpayOrderId: order.razorpayOrderId },
        'Reconciliation: failed to process stale order, will retry next run'
      );
      result.skipped++;
    }
  }

  return result;
}

async function inspectPayments(
  razorpayOrderId: string
): Promise<{ capturedPaymentId: string | null; attempts: number }> {
  const { items } = await razorpay.orders.fetchPayments(razorpayOrderId);
  const captured = items.find((p) => p.status === 'captured' || p.status === 'authorized');
  return { capturedPaymentId: captured ? captured.id : null, attempts: items.length };
}
