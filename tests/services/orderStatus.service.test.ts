import { OrderStatus } from '@prisma/client';

jest.mock('../../src/config/db', () => ({
  prisma: {
    order: { update: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock('../../src/services/cache.service', () => ({
  deleteCache: jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/googleSheets.service', () => ({
  notifyOrderStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../src/config/db';
import { deleteCache, deleteCachePattern } from '../../src/services/cache.service';
import { notifyOrderStatusChanged } from '../../src/services/googleSheets.service';
import { updateOrderStatusById } from '../../src/services/orderStatus.service';

describe('updateOrderStatusById', () => {
  it('updates the order, invalidates caches, and mirrors the change to Google Sheets', async () => {
    (prisma.order.update as jest.Mock).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      orderNumber: 'KGR1',
      status: OrderStatus.SHIPPED,
      statusHistory: [{ status: OrderStatus.SHIPPED, note: 'On the way' }],
    });

    const result = await updateOrderStatusById('order-1', {
      status: OrderStatus.SHIPPED,
      note: 'On the way',
      updatedBy: 'admin-1',
    });

    expect(result.status).toBe(OrderStatus.SHIPPED);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: OrderStatus.SHIPPED,
          statusHistory: { create: { status: OrderStatus.SHIPPED, note: 'On the way', updatedBy: 'admin-1' } },
        }),
      })
    );
    expect(deleteCache).toHaveBeenCalledWith('orders:order-1');
    expect(deleteCachePattern).toHaveBeenCalledWith('orders:user:user-1:*');
    expect(deleteCachePattern).toHaveBeenCalledWith('orders:all:*');
    expect(notifyOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', status: OrderStatus.SHIPPED })
    );
  });
});
