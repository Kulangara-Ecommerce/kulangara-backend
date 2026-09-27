import { OrderStatus, PaymentStatus } from '@prisma/client';

jest.mock('google-auth-library', () => ({
  JWT: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue({ token: 'fake-access-token' }),
  })),
}));

jest.mock('../../src/config/db', () => ({
  prisma: {
    order: { findUnique: jest.fn() },
  },
}));

const originalEnv = { ...process.env };

function setSheetsEnv(): void {
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'bot@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-123';
}

function clearSheetsEnv(): void {
  delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  delete process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

describe('googleSheets.service', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('is a safe no-op when Google Sheets env vars are not configured', async () => {
    clearSheetsEnv();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));

    const { notifyOrderCreated, notifyOrderStatusChanged, isSheetsConfigured } = await import(
      '../../src/services/googleSheets.service'
    );

    expect(isSheetsConfigured()).toBe(false);

    await notifyOrderCreated({ id: 'order-1' } as never);
    await notifyOrderStatusChanged({ id: 'order-1', orderNumber: 'KGR1' } as never);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('appends a new row with the order details when a new order is created', async () => {
    setSheetsEnv();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const { notifyOrderCreated } = await import('../../src/services/googleSheets.service');
    const { prisma } = await import('../../src/config/db');
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-1',
      orderNumber: 'KGR12345678',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      totalAmount: 599,
      paymentMethod: 'RAZORPAY',
      paymentStatus: PaymentStatus.PENDING,
      status: OrderStatus.PENDING,
      user: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '9999999999' },
      items: [{ quantity: 1, size: 'M', fit: 'NORMAL', product: { name: 'Classic Tee' } }],
    });

    await notifyOrderCreated({ id: 'order-1' } as never);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(':append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values[0]).toEqual(
      expect.arrayContaining(['KGR12345678', 'asha@example.com', 'Classic Tee (M, NORMAL) x1'])
    );
    fetchSpy.mockRestore();
  });

  it('does not throw when the Sheets API call fails — a broken sheet must never break an order', async () => {
    setSheetsEnv();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('server error', { status: 500 })
    );

    const { notifyOrderCreated } = await import('../../src/services/googleSheets.service');
    const { prisma } = await import('../../src/config/db');
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-1',
      orderNumber: 'KGR1',
      createdAt: new Date(),
      totalAmount: 100,
      paymentMethod: 'COD',
      paymentStatus: PaymentStatus.PENDING,
      status: OrderStatus.CONFIRMED,
      user: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: null },
      items: [],
    });

    await expect(notifyOrderCreated({ id: 'order-1' } as never)).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('applies only valid, changed admin status updates from the sheet and skips the rest', async () => {
    setSheetsEnv();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/values/Orders!A2%3AL')) {
        return new Response(
          JSON.stringify({
            values: [
              ['KGR1', ...Array(9).fill(''), 'SHIPPED', 'PENDING'], // valid, changed -> should apply
              ['KGR2', ...Array(9).fill(''), 'NOT_A_STATUS', ''], // invalid -> should be skipped
              ['KGR3', ...Array(9).fill(''), 'DELIVERED', 'DELIVERED'], // unchanged -> should be skipped
            ],
          })
        );
      }
      return new Response('{}');
    });

    const { syncAdminStatusUpdatesFromSheet } = await import('../../src/services/googleSheets.service');
    const applyUpdate = jest.fn().mockResolvedValue(undefined);

    const result = await syncAdminStatusUpdatesFromSheet(applyUpdate);

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(applyUpdate).toHaveBeenCalledWith('KGR1', 'SHIPPED');
    expect(result).toEqual({ checked: 3, applied: 1 });
    fetchSpy.mockRestore();
  });
});
