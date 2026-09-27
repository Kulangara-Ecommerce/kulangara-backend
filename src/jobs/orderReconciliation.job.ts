import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../config/queue';
import { env } from '../config/env';
import {
  reconcileStalePendingOrders,
  DEFAULT_RECONCILIATION_THRESHOLD_MINUTES,
} from '../services/orderReconciliation.service';
import { logger } from '../utils/logger';

const QUEUE_NAME = 'order-reconciliation';
const REPEAT_EVERY_MS = 10 * 60 * 1000; // every 10 minutes
const JOB_NAME = 'reconcile-stale-orders';

let queue: Queue | null = null;
let worker: Worker | null = null;

export async function startOrderReconciliationJob(): Promise<void> {
  if (queue || worker) {
    return;
  }

  queue = new Queue(QUEUE_NAME, { connection: bullmqConnection });
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const thresholdMinutes =
        env.ORDER_RECONCILIATION_THRESHOLD_MINUTES ?? DEFAULT_RECONCILIATION_THRESHOLD_MINUTES;
      const result = await reconcileStalePendingOrders(thresholdMinutes);
      if (result.checked > 0) {
        logger.info({ result }, 'Order reconciliation run complete');
      }
      return result;
    },
    { connection: bullmqConnection }
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Order reconciliation job run failed');
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

  logger.info({ everyMs: REPEAT_EVERY_MS }, 'Order reconciliation job scheduled');
}

export async function stopOrderReconciliationJob(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
