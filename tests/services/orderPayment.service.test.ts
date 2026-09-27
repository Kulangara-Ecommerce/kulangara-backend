import { OrderStatus, PaymentStatus } from '@prisma/client';

jest.mock('../../src/config/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    orderItem: { create: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    cartItem: { deleteMany: jest.fn() },
    cart: { updateMany: jest.fn() },
    coupon: { findFirst: jest.fn(), update: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/services/stock.service', () => ({
  reserveStock: jest.fn(),
  restoreStock: jest.fn(),
}));

jest.mock('../../src/services/cache.service', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/googleSheets.service', () => ({
  notifyOrderCreated: jest.fn().mockResolvedValue(undefined),
  notifyOrderStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../src/config/db';
import { reserveStock, restoreStock } from '../../src/services/stock.service';
import {
  createPendingOrderFromCart,
  confirmOrderPaymentByRazorpayOrderId,
  failOrderPaymentByRazorpayOrderId,
} from '../../src/services/orderPayment.service';

const mockPrisma = prisma as unknown as {
  order: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  orderItem: { create: jest.Mock };
  orderStatusHistory: { create: jest.Mock };
  cartItem: { deleteMany: jest.Mock };
  cart: { updateMany: jest.Mock };
  coupon: { findFirst: jest.Mock; update: jest.Mock };
  productVariant: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

beforeEach(() => {
  // $transaction just runs the callback against the same mocked client,
  // which is enough for unit-testing the logic without a real DB.
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(mockPrisma));
});

describe('createPendingOrderFromCart', () => {
  const cartData = {
    items: [{ productId: 'prod-1', variantId: 'var-1', quantity: 2, price: 100 }],
    subtotal: 200,
    discount: 0,
    total: 200,
    shippingAddressId: 'addr-1',
  };

  it('creates a PENDING/PENDING order and reserves stock before any payment happens', async () => {
    (reserveStock as jest.Mock).mockResolvedValue({
      success: true,
      reservedItems: [{ productId: 'prod-1', variantId: 'var-1', quantity: 2, price: 100, productName: 'Tee' }],
    });
    mockPrisma.productVariant.findUnique.mockResolvedValue({ size: 'M', fit: 'NORMAL' });
    mockPrisma.order.create.mockResolvedValue({ id: 'order-1', razorpayOrderId: 'rzp_order_1' });

    const order = await createPendingOrderFromCart({
      razorpayOrderId: 'rzp_order_1',
      userId: 'user-1',
      cartData,
    });

    expect(order.id).toBe('order-1');
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: 'RAZORPAY',
          razorpayOrderId: 'rzp_order_1',
        }),
      })
    );
    // Cart is NOT cleared and coupon usage is NOT incremented at creation time —
    // that only happens once the payment is actually confirmed.
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('propagates a stock reservation failure instead of creating an order', async () => {
    (reserveStock as jest.Mock).mockResolvedValue({
      success: false,
      message: 'Insufficient stock for product variant: Tee (M)',
    });

    await expect(
      createPendingOrderFromCart({ razorpayOrderId: 'rzp_order_2', userId: 'user-1', cartData })
    ).rejects.toThrow('Insufficient stock');

    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });
});

describe('confirmOrderPaymentByRazorpayOrderId', () => {
  it('returns null when no order matches the Razorpay order id', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const result = await confirmOrderPaymentByRazorpayOrderId('rzp_missing', 'pay_1');

    expect(result).toBeNull();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirms a PENDING order: marks it paid, clears the cart, bumps coupon usage once', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      couponId: 'coupon-1',
      paymentStatus: PaymentStatus.PENDING,
    });
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    });

    const result = await confirmOrderPaymentByRazorpayOrderId('rzp_order_1', 'pay_1');

    expect(result).toMatchObject({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID });
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cart: { userId: 'user-1' } } });
    expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
      where: { id: 'coupon-1' },
      data: { usageCount: { increment: 1 } },
    });
  });

  it('is idempotent: a second concurrent call does not double-clear the cart or double-increment the coupon', async () => {
    // First call already flipped paymentStatus to PENDING->not-PAID via updateMany (count 1).
    // Simulate the second, racing call arriving after that: findUnique now sees PAID already.
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      couponId: 'coupon-1',
      paymentStatus: PaymentStatus.PAID,
    });

    const result = await confirmOrderPaymentByRazorpayOrderId('rzp_order_1', 'pay_1');

    expect(result).toMatchObject({ paymentStatus: PaymentStatus.PAID });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.coupon.update).not.toHaveBeenCalled();
  });

  it('is safe against a tight race inside the transaction (updateMany reports count 0)', async () => {
    mockPrisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        userId: 'user-1',
        couponId: null,
        paymentStatus: PaymentStatus.PENDING,
      })
      .mockResolvedValueOnce({ id: 'order-1', paymentStatus: PaymentStatus.PAID });
    mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await confirmOrderPaymentByRazorpayOrderId('rzp_order_1', 'pay_1');

    expect(result).toMatchObject({ paymentStatus: PaymentStatus.PAID });
    expect(mockPrisma.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('failOrderPaymentByRazorpayOrderId', () => {
  it('cancels a PENDING order and restores the stock reserved for it', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      items: [{ productId: 'prod-1', variantId: 'var-1', quantity: 2 }],
    });
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.FAILED,
    });

    const result = await failOrderPaymentByRazorpayOrderId('rzp_order_1', 'timed out');

    expect(result).toMatchObject({ status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.FAILED });
    expect(restoreStock).toHaveBeenCalledWith(
      [{ productId: 'prod-1', variantId: 'var-1', quantity: 2 }],
      expect.anything()
    );
  });

  it('refuses to fail an order that has already been paid', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
      items: [],
    });

    const result = await failOrderPaymentByRazorpayOrderId('rzp_order_1', 'reconciliation timeout');

    expect(result).toMatchObject({ paymentStatus: PaymentStatus.PAID });
    expect(restoreStock).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('is idempotent: does not restore stock twice for an already-cancelled order', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.FAILED,
      items: [{ productId: 'prod-1', quantity: 1 }],
    });

    await failOrderPaymentByRazorpayOrderId('rzp_order_1', 'already failed once');

    expect(restoreStock).not.toHaveBeenCalled();
  });
});
