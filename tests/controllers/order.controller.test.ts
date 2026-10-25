import { Request, Response } from 'express';

jest.mock('../../src/config/db', () => ({
  prisma: {
    $transaction: jest.fn(),
    order: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock('../../src/services/cache.service', () => ({
  cacheWrapper: jest.fn(async (_key: string, fn: () => unknown) => fn()),
  deleteCache: jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/stock.service', () => ({
  reserveStock: jest.fn(),
  restoreStock: jest.fn(),
}));

jest.mock('../../src/services/orderStatus.service', () => ({
  updateOrderStatusById: jest.fn(),
}));

jest.mock('../../src/services/googleSheets.service', () => ({
  notifyOrderCreated: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../src/config/db';
import { reserveStock } from '../../src/services/stock.service';
import { notifyOrderCreated } from '../../src/services/googleSheets.service';
import { createOrder, listAllOrders } from '../../src/controllers/order.controller';
import { REVENUE_STATUSES, UNSUCCESSFUL_ORDER_STATUSES } from '../../src/constants';
import { OrderStatus } from '@prisma/client';

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('createOrder', () => {
  it('sends a single 400 response and never a follow-up 201 when stock reservation fails inside the transaction', async () => {
    (reserveStock as jest.Mock).mockResolvedValue({ success: false, message: 'Insufficient stock for Tee' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(prisma)
    );

    const req = {
      user: { id: 'user-1' },
      body: {
        shippingAddressId: 'addr-1',
        paymentMethod: 'COD',
        items: [{ productId: 'prod-1', quantity: 1 }],
      },
    } as unknown as Request;
    const res = mockResponse();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(notifyOrderCreated).not.toHaveBeenCalled();
  });
});

describe('listAllOrders filters', () => {
  const callList = async (query: Record<string, unknown>) => {
    (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.order.count as jest.Mock).mockResolvedValue(0);
    const res = mockResponse();
    await listAllOrders({ query } as unknown as Request, res);
    return res;
  };
  const lastWhere = () => (prisma.order.findMany as jest.Mock).mock.calls.at(-1)[0].where;

  beforeEach(() => jest.clearAllMocks());

  it('splits every order status into exactly one of the two groups', () => {
    const all = Object.values(OrderStatus).sort();
    expect([...REVENUE_STATUSES, ...UNSUCCESSFUL_ORDER_STATUSES].sort()).toEqual(all);
    expect(UNSUCCESSFUL_ORDER_STATUSES).toEqual(
      expect.arrayContaining(['PENDING', 'CANCELLED', 'RETURNED', 'REFUNDED'])
    );
  });

  it('group=successful only matches revenue statuses', async () => {
    await callList({ group: 'successful' });
    expect(lastWhere().status).toEqual({ in: REVENUE_STATUSES });
  });

  it('group=unsuccessful only matches the other statuses', async () => {
    await callList({ group: 'unsuccessful' });
    expect(lastWhere().status).toEqual({ in: UNSUCCESSFUL_ORDER_STATUSES });
  });

  it('keeps an explicit status that falls inside the group', async () => {
    await callList({ group: 'successful', status: 'SHIPPED' });
    expect(lastWhere().status).toBe('SHIPPED');
  });

  it('returns nothing when the explicit status is outside the group', async () => {
    await callList({ group: 'successful', status: 'CANCELLED' });
    expect(lastWhere().status).toEqual({ in: [] });
  });

  it('applies paymentStatus and a case-insensitive paymentMethod', async () => {
    await callList({ paymentStatus: 'PAID', paymentMethod: 'razorpay' });
    expect(lastWhere().paymentStatus).toBe('PAID');
    expect(lastWhere().paymentMethod).toEqual({ equals: 'razorpay', mode: 'insensitive' });
  });

  it.each([
    [{ group: 'toString' }, 'group'],
    [{ status: 'NOPE' }, 'status'],
    [{ paymentStatus: 'NOPE' }, 'paymentStatus'],
  ])('rejects invalid %j with 400 and never queries', async (query, field) => {
    const res = await callList(query);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: `Invalid ${field} filter` })
    );
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
