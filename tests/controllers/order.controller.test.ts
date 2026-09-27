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
import { createOrder } from '../../src/controllers/order.controller';

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
