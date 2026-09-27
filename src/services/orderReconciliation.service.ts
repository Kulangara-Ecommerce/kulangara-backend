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
      const capturedPaymentId = await findCapturedPaymentId(order.razorpayOrderId);

      if (capturedPaymentId) {
        await confirmOrderPaymentByRazorpayOrderId(order.razorpayOrderId, capturedPaymentId);
        result.confirmed++;
        logger.info(
          { orderId: order.id, razorpayOrderId: order.razorpayOrderId },
          'Reconciliation: self-healed a stale order that Razorpay shows as paid'
        );
      } else {
        await failOrderPaymentByRazorpayOrderId(
          order.razorpayOrderId,
          `No successful payment found ${thresholdMinutes} minutes after order creation`
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

async function findCapturedPaymentId(razorpayOrderId: string): Promise<string | null> {
  const { items } = await razorpay.orders.fetchPayments(razorpayOrderId);
  const captured = items.find((p) => p.status === 'captured' || p.status === 'authorized');
  return captured ? captured.id : null;
}
