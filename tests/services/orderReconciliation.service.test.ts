import { OrderStatus, PaymentStatus } from '@prisma/client';

jest.mock('../../src/config/db', () => ({
  prisma: {
    order: { findMany: jest.fn() },
  },
}));

jest.mock('../../src/config/razorpay', () => ({
  razorpay: {
    orders: { fetchPayments: jest.fn() },
  },
}));

jest.mock('../../src/services/orderPayment.service', () => ({
  confirmOrderPaymentByRazorpayOrderId: jest.fn(),
  failOrderPaymentByRazorpayOrderId: jest.fn(),
}));

import { prisma } from '../../src/config/db';
import { razorpay } from '../../src/config/razorpay';
import {
  confirmOrderPaymentByRazorpayOrderId,
  failOrderPaymentByRazorpayOrderId,
} from '../../src/services/orderPayment.service';
import { reconcileStalePendingOrders } from '../../src/services/orderReconciliation.service';

const mockFindMany = (prisma.order as unknown as { findMany: jest.Mock }).findMany;
const mockFetchPayments = (razorpay.orders as unknown as { fetchPayments: jest.Mock }).fetchPayments;

const staleOrder = {
  id: 'order-1',
  razorpayOrderId: 'rzp_order_1',
  status: OrderStatus.PENDING,
  paymentStatus: PaymentStatus.PENDING,
  paymentMethod: 'RAZORPAY',
  createdAt: new Date(Date.now() - 60 * 60 * 1000),
};

describe('reconcileStalePendingOrders', () => {
  it('only looks at orders that are still PENDING/PENDING past the threshold', async () => {
    mockFindMany.mockResolvedValue([]);

    await reconcileStalePendingOrders(45);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: 'RAZORPAY',
        }),
      })
    );
  });

  it('self-heals a stale order that Razorpay actually captured — never trusts silence over money already taken', async () => {
    mockFindMany.mockResolvedValue([staleOrder]);
    mockFetchPayments.mockResolvedValue({
      items: [{ id: 'pay_1', status: 'captured' }],
    });

    const result = await reconcileStalePendingOrders(45);

    expect(confirmOrderPaymentByRazorpayOrderId).toHaveBeenCalledWith('rzp_order_1', 'pay_1');
    expect(failOrderPaymentByRazorpayOrderId).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, skipped: 0 });
  });

  it('fails a stale order with no successful payment at Razorpay and releases its stock', async () => {
    mockFindMany.mockResolvedValue([staleOrder]);
    mockFetchPayments.mockResolvedValue({ items: [] });

    const result = await reconcileStalePendingOrders(45);

    expect(failOrderPaymentByRazorpayOrderId).toHaveBeenCalledWith(
      'rzp_order_1',
      expect.stringContaining('No successful payment')
    );
    expect(confirmOrderPaymentByRazorpayOrderId).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 1, skipped: 0 });
  });

  it('skips (and does not crash) when the Razorpay lookup itself throws, so it retries next run', async () => {
    mockFindMany.mockResolvedValue([staleOrder]);
    mockFetchPayments.mockRejectedValue(new Error('Razorpay API timeout'));

    const result = await reconcileStalePendingOrders(45);

    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, skipped: 1 });
  });
});
