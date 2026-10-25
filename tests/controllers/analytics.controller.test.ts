import { Request, Response } from 'express';

jest.mock('../../src/config/db', () => ({
  prisma: {
    user: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    order: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: {}, _avg: {} }) },
    product: { count: jest.fn().mockResolvedValue(0) },
  },
}));

jest.mock('../../src/services/cache.service', () => ({
  cacheWrapper: jest.fn(async (_key: string, fn: () => unknown) => fn()),
}));

import { prisma } from '../../src/config/db';
import { getDashboardStats } from '../../src/controllers/analytics.controller';
import { REVENUE_STATUSES } from '../../src/constants';

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('getDashboardStats order counts', () => {
  it('counts only successful orders for total and today, and reports pending separately', async () => {
    const orderCount = prisma.order.count as jest.Mock;
    orderCount.mockClear();
    orderCount.mockResolvedValueOnce(59).mockResolvedValueOnce(2).mockResolvedValueOnce(4);

    const res = mockResponse();
    await getDashboardStats({} as Request, res);

    const wheres = orderCount.mock.calls.map(([arg]) => arg.where);
    expect(wheres[0]).toEqual({ status: { in: REVENUE_STATUSES } });
    expect(wheres[1]).toEqual({
      status: { in: REVENUE_STATUSES },
      createdAt: { gte: expect.any(Date) },
    });
    expect(wheres[2]).toEqual({ status: 'PENDING' });

    const { data } = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.orders).toMatchObject({ total: 59, ordersToday: 2, pending: 4 });
  });
});
