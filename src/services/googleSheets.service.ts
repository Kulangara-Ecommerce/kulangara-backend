import { JWT } from 'google-auth-library';
import { Order, OrderStatus } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Column layout of the "Orders" sheet (1 header row, then one row per order):
// A Order Number | B Date | C Customer | D Email | E Phone | F Items |
// G Total | H Payment Method | I Payment Status | J Order Status |
// K Admin Status Update (editable by admin) | L Last Synced Status | M Sync Notes
const HEADER_ROW = [
  'Order Number',
  'Date',
  'Customer',
  'Email',
  'Phone',
  'Items',
  'Total',
  'Payment Method',
  'Payment Status',
  'Order Status',
  'Admin Status Update',
  'Last Synced Status',
  'Sync Notes',
];

let jwtClient: JWT | null = null;

export function isSheetsConfigured(): boolean {
  return Boolean(
    env.GOOGLE_SHEETS_CLIENT_EMAIL &&
      env.GOOGLE_SHEETS_PRIVATE_KEY &&
      env.GOOGLE_SHEETS_SPREADSHEET_ID
  );
}

function getSheetName(): string {
  return env.GOOGLE_SHEETS_SHEET_NAME || 'Orders';
}

function getClient(): JWT {
  if (!jwtClient) {
    jwtClient = new JWT({
      email: env.GOOGLE_SHEETS_CLIENT_EMAIL,
      // .env files typically escape newlines in the PEM key as literal "\n"
      key: env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: [SHEETS_SCOPE],
    });
  }
  return jwtClient;
}

async function getAccessToken(): Promise<string> {
  const { token } = await getClient().getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain Google Sheets access token');
  }
  return token;
}

async function sheetsFetch(
  path: string,
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {}
): Promise<unknown> {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const token = await getAccessToken();
  const query = new URLSearchParams(init.query).toString();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Sheets API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function appendRow(values: (string | number)[]): Promise<void> {
  const range = `${getSheetName()}!A:M`;
  await sheetsFetch(`/values/${encodeURIComponent(range)}:append`, {
    method: 'POST',
    query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
    body: { values: [values] },
  });
}

async function readRange(range: string): Promise<string[][]> {
  const data = (await sheetsFetch(`/values/${encodeURIComponent(range)}`)) as {
    values?: string[][];
  };
  return data.values || [];
}

async function updateRange(range: string, values: (string | number)[][]): Promise<void> {
  await sheetsFetch(`/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    query: { valueInputOption: 'USER_ENTERED' },
    body: { values },
  });
}

/** Ensures the header row exists; safe to call repeatedly. */
export async function ensureSheetHeader(): Promise<void> {
  const existing = await readRange(`${getSheetName()}!A1:M1`);
  if (existing.length > 0 && existing[0]?.[0]) {
    return;
  }
  await updateRange(`${getSheetName()}!A1:M1`, [HEADER_ROW]);
}

async function findOrderRowNumber(orderNumber: string): Promise<number | null> {
  const rows = await readRange(`${getSheetName()}!A2:A`);
  const index = rows.findIndex((row) => row[0] === orderNumber);
  return index === -1 ? null : index + 2; // +2: 1-indexed, plus header row
}

function buildOrderRow(order: {
  orderNumber: string;
  createdAt: Date;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  user: { firstName: string; lastName: string; email: string; phone: string | null };
  items: Array<{
    quantity: number;
    size: string | null;
    fit: string | null;
    product: { name: string };
  }>;
}): (string | number)[] {
  const itemsSummary = order.items
    .map((item) => {
      const variant = [item.size, item.fit].filter(Boolean).join(', ');
      return `${item.product.name}${variant ? ` (${variant})` : ''} x${item.quantity}`;
    })
    .join('; ');

  return [
    order.orderNumber,
    order.createdAt.toISOString(),
    `${order.user.firstName} ${order.user.lastName}`,
    order.user.email,
    order.user.phone || '',
    itemsSummary,
    order.totalAmount.toFixed(2),
    order.paymentMethod,
    order.paymentStatus,
    order.status,
    '', // Admin Status Update — left for the admin to fill in
    order.status, // Last Synced Status
    '', // Sync Notes
  ];
}

/** Appends a new row for a freshly-created order. No-op if sync isn't configured. */
export async function notifyOrderCreated(order: Order): Promise<void> {
  if (!isSheetsConfigured()) {
    return;
  }

  try {
    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });
    if (!full) {
      return;
    }

    await appendRow(buildOrderRow(full));
  } catch (err) {
    logger.warn({ err, orderId: order.id }, 'googleSheets: failed to append new order row');
  }
}

/**
 * Mirrors a status change back onto the order's row. Falls back to appending
 * a fresh row if one can't be found (e.g. sync was enabled after the order
 * was created), so the sheet is eventually consistent rather than silently
 * missing rows.
 */
export async function notifyOrderStatusChanged(order: Order): Promise<void> {
  if (!isSheetsConfigured()) {
    return;
  }

  try {
    const rowNumber = await findOrderRowNumber(order.orderNumber);
    if (rowNumber === null) {
      await notifyOrderCreated(order);
      return;
    }

    await updateRange(`${getSheetName()}!I${rowNumber}:L${rowNumber}`, [
      [order.paymentStatus, order.status, order.status, ''],
    ]);
  } catch (err) {
    logger.warn({ err, orderId: order.id }, 'googleSheets: failed to sync order status change');
  }
}

async function writeSyncNote(rowNumber: number, note: string): Promise<void> {
  await updateRange(`${getSheetName()}!M${rowNumber}`, [[note]]);
}

const VALID_ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));

/**
 * Polls the sheet for rows where an admin has typed a new value into the
 * "Admin Status Update" column that differs from what we last synced, and
 * applies it via `applyUpdate`. Returns counts for logging/tests.
 */
export async function syncAdminStatusUpdatesFromSheet(
  applyUpdate: (orderNumber: string, status: OrderStatus) => Promise<void>
): Promise<{ checked: number; applied: number }> {
  if (!isSheetsConfigured()) {
    return { checked: 0, applied: 0 };
  }

  const rows = await readRange(`${getSheetName()}!A2:L`);
  let applied = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const orderNumber = row[0]?.trim();
    const adminStatusRaw = row[10]?.trim() ?? '';
    const lastSynced = row[11]?.trim() ?? '';
    const rowNumber = i + 2;

    if (!orderNumber || !adminStatusRaw) {
      continue;
    }

    const adminStatus = adminStatusRaw.toUpperCase();
    if (adminStatus === lastSynced.toUpperCase()) {
      continue;
    }

    if (!VALID_ORDER_STATUSES.has(adminStatus)) {
      await writeSyncNote(rowNumber, `Ignored: "${adminStatusRaw}" is not a valid status`).catch(
        () => {}
      );
      continue;
    }

    try {
      await applyUpdate(orderNumber, adminStatus as OrderStatus);
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await writeSyncNote(rowNumber, `Failed to apply "${adminStatus}": ${message}`).catch(
        () => {}
      );
      logger.warn(
        { err, orderNumber, adminStatus },
        'googleSheets: failed to apply admin status update'
      );
    }
  }

  return { checked: rows.length, applied };
}
