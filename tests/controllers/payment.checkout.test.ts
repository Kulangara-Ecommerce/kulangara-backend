import { Request, Response } from 'express';

// In-memory stand-ins so two requests can genuinely race each other.
const store = { locks: new Set<string>(), orders: [] as Array<Record<string, unknown>> };

jest.mock('../../src/config/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        phone: '999',
      }),
    },
    address: { findFirst: jest.fn().mockResolvedValue({ id: 'addr-1' }) },
    productVariant: {
      findUnique: jest.fn().mockResolvedValue({ price: 599, product: { id: 'p1', price: 599 } }),
    },
    product: { findUnique: jest.fn() },
    order: {
      findMany: jest.fn(async () =>
        store.orders.map((o) => ({
          ...o,
          items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }],
        }))
      ),
    },
  },
}));

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (key: string) => {
      if (store.locks.has(key)) return null;
      store.locks.add(key);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.locks.delete(key);
      return 1;
    }),
  },
}));

jest.mock('../../src/config/razorpay', () => ({
  razorpay: {
    orders: {
      create: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 50)); // slow enough for the race to matter
        return { id: `order_${store.orders.length + 1}`, amount: 59900, currency: 'INR' };
      }),
    },
  },
}));

jest.mock('../../src/services/orderPayment.service', () => ({
  ...jest.requireActual('../../src/services/orderPayment.service'),
  createPendingOrderFromCart: jest.fn(async (input: { razorpayOrderId: string }) => {
    store.orders.push({
      razorpayOrderId: input.razorpayOrderId,
      totalAmount: 599,
      status: 'PENDING',
      paymentStatus: 'PENDING',
    });
  }),
}));

import { razorpay } from '../../src/config/razorpay';
import { createPendingOrderFromCart } from '../../src/services/orderPayment.service';
import { createRazorpayOrderFromCart } from '../../src/controllers/payment.controller';

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const makeReq = () =>
  ({
    user: { id: 'user-1' },
    body: {
      cartData: {
        items: [{ productId: 'p1', variantId: 'v1', quantity: 1, price: 599 }],
        subtotal: 599,
        discount: 0,
        total: 599,
        shippingAddressId: 'addr-1',
      },
    },
  }) as unknown as Request;

beforeEach(() => {
  store.locks.clear();
  store.orders.length = 0;
  jest.clearAllMocks();
});

describe('createRazorpayOrderFromCart duplicate protection', () => {
  it('creates exactly one Razorpay order and one DB order when the same checkout is sent twice at once', async () => {
    const [res1, res2] = [mockResponse(), mockResponse()];

    await Promise.all([
      createRazorpayOrderFromCart(makeReq(), res1),
      createRazorpayOrderFromCart(makeReq(), res2),
    ]);

    expect(razorpay.orders.create).toHaveBeenCalledTimes(1);
    expect(createPendingOrderFromCart).toHaveBeenCalledTimes(1);

    const id1 = (res1.json as jest.Mock).mock.calls[0][0].data.orderId;
    const id2 = (res2.json as jest.Mock).mock.calls[0][0].data.orderId;
    expect(id1).toBe(id2);
  });

  it('reuses the pending order on a later retry instead of creating another', async () => {
    await createRazorpayOrderFromCart(makeReq(), mockResponse());
    const res = mockResponse();
    await createRazorpayOrderFromCart(makeReq(), res);

    expect(razorpay.orders.create).toHaveBeenCalledTimes(1);
    expect((res.json as jest.Mock).mock.calls[0][0].data.orderId).toBe('order_1');
  });

  it('releases the lock afterwards so the user is never blocked from checking out again', async () => {
    await createRazorpayOrderFromCart(makeReq(), mockResponse());
    expect(store.locks.size).toBe(0);
  });
});
