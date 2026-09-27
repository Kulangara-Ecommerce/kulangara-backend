import { Queue, Worker } from 'bullmq';
import { OrderStatus } from '@prisma/client';
import { bullmqConnection } from '../config/queue';
import {
  isSheetsConfigured,
  syncAdminStatusUpdatesFromSheet,
} from '../services/googleSheets.service';
import { findOrderByOrderNumber, updateOrderStatusById } from '../services/orderStatus.service';
import { logger } from '../utils/logger';

const QUEUE_NAME = 'sheet-status-sync';
const REPEAT_EVERY_MS = 5 * 60 * 1000; // every 5 minutes
const JOB_NAME = 'sync-admin-status-updates';

let queue: Queue | null = null;
let worker: Worker | null = null;

async function applyAdminStatusUpdate(orderNumber: string, status: OrderStatus): Promise<void> {
  const order = await findOrderByOrderNumber(orderNumber);
  if (!order) {
    throw new Error(`No order found with order number "${orderNumber}"`);
  }
  await updateOrderStatusById(order.id, {
    status,
    note: 'Status updated by admin via Google Sheets',
  });
}

export async function startSheetSyncJob(): Promise<void> {
  if (!isSheetsConfigured()) {
    logger.info('Google Sheets sync is not configured — skipping sheet-sync job');
    return;
  }

  if (queue || worker) {
    return;
  }

  queue = new Queue(QUEUE_NAME, { connection: bullmqConnection });
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await syncAdminStatusUpdatesFromSheet(applyAdminStatusUpdate);
      if (result.applied > 0) {
        logger.info({ result }, 'Applied admin order status updates from Google Sheets');
      }
      return result;
    },
    { connection: bullmqConnection }
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Sheet status sync job run failed');
  });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: REPEAT_EVERY_MS },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    }
  );

  logger.info({ everyMs: REPEAT_EVERY_MS }, 'Google Sheets status sync job scheduled');
}

export async function stopSheetSyncJob(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
