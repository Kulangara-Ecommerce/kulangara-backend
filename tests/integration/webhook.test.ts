import crypto from 'crypto';
import request from 'supertest';

// The whole point of this test is to exercise the REAL middleware chain in
// src/app.ts (raw body parser -> HMAC signature check -> handler), so only
// mock things below the webhook controller, never the app/routing itself.
jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
  },
}));

jest.mock('../../src/services/orderPayment.service', () => ({
  createPendingOrderFromCart: jest.fn(),
  confirmOrderPaymentByRazorpayOrderId: jest.fn().mockResolvedValue({ id: 'order-1' }),
  failOrderPaymentByRazorpayOrderId: jest.fn().mockResolvedValue({ id: 'order-1' }),
  findOrderByRazorpayOrderId: jest.fn(),
}));

jest.mock('../../src/config/db', () => ({
  prisma: {
    order: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $connect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

import { app } from '../../src/app';
import {
  confirmOrderPaymentByRazorpayOrderId,
  failOrderPaymentByRazorpayOrderId,
} from '../../src/services/orderPayment.service';

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;
const WEBHOOK_PATH = '/api/v1/payments/webhook';

function sign(rawBody: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

describe('POST /api/v1/payments/webhook (raw body regression test)', () => {
  it('verifies a real Razorpay-style signature and confirms the order — this fails if express.json() ever runs before the raw parser again', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_1',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_1', order_id: 'order_rzp_1', status: 'captured' },
        },
      },
    });

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(rawBody))
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success' });
    expect(confirmOrderPaymentByRazorpayOrderId).toHaveBeenCalledWith('order_rzp_1', 'pay_1');
  });

  it('routes payment.failed events to failOrderPaymentByRazorpayOrderId', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_2',
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_2', order_id: 'order_rzp_2', status: 'failed' },
        },
      },
    });

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(rawBody))
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(failOrderPaymentByRazorpayOrderId).toHaveBeenCalledWith('order_rzp_2', 'Payment failed');
  });

  it('rejects a request with an invalid signature instead of silently trusting it', async () => {
    const rawBody = JSON.stringify({ id: 'evt_3', event: 'payment.captured', payload: {} });

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'not-the-right-signature')
      .send(rawBody);

    expect(response.status).toBe(400);
    expect(confirmOrderPaymentByRazorpayOrderId).not.toHaveBeenCalled();
  });
});
