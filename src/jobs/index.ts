import { env } from '../config/env';
import { logger } from '../utils/logger';
import { startOrderReconciliationJob, stopOrderReconciliationJob } from './orderReconciliation.job';
import { startSheetSyncJob, stopSheetSyncJob } from './sheetSync.job';

/**
 * Starts all recurring background jobs. No-op in tests and when explicitly
 * disabled via DISABLE_BACKGROUND_JOBS, so importing this module never has
 * side effects unless the server is actually running.
 */
export function startBackgroundJobs(): void {
  if (env.NODE_ENV === 'test' || env.DISABLE_BACKGROUND_JOBS) {
    return;
  }

  startOrderReconciliationJob().catch((err) =>
    logger.error({ err }, 'Failed to start order reconciliation job')
  );
  startSheetSyncJob().catch((err) => logger.error({ err }, 'Failed to start sheet sync job'));
}

export async function stopBackgroundJobs(): Promise<void> {
  await Promise.all([stopOrderReconciliationJob(), stopSheetSyncJob()]);
}
