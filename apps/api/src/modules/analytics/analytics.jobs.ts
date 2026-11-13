import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { AnalyticsService } from './analytics.service.js';
import {
  registerMaintenanceHandler,
  scheduleMaintenanceJob,
} from '../../queue/maintenance.jobs.js';

/** Queue name for housekeeping jobs (B1.4). Domain modules share it. */
export const MAINTENANCE_QUEUE = 'maintenance';
/** Drains the Redis buffer into analytics_events (B7.1). */
export const ANALYTICS_FLUSH_JOB = 'analytics:flush';
export const ANALYTICS_FLUSH_EVERY_MS = 30_000;
/** Rolls raw events up into analytics_daily + prunes (B7.2). */
export const ANALYTICS_ROLLUP_JOB = 'analytics:rollup';
export const ANALYTICS_ROLLUP_EVERY_MS = 15 * 60 * 1000;

const logger = new Logger('AnalyticsJobs');

/**
 * Worker-side registration (B7.1/B7.2) — the otp.jobs.ts pattern: inert in
 * the API process, idempotent repeatables (BullMQ dedupes by scheduler id).
 */
export function registerAnalyticsJobs(workers: WorkersService, analytics: AnalyticsService): void {
  registerMaintenanceHandler(ANALYTICS_FLUSH_JOB, async () => {
    const landed = await analytics.flush();
    if (landed > 0) logger.log(`analytics:flush landed ${landed} event(s)`);
  });
  scheduleMaintenanceJob(workers, ANALYTICS_FLUSH_JOB, ANALYTICS_FLUSH_EVERY_MS);

  registerMaintenanceHandler(ANALYTICS_ROLLUP_JOB, async () => {
    const buckets = await analytics.rollup();
    if (buckets > 0) logger.log(`analytics:rollup wrote ${buckets} bucket(s)`);
  });
  scheduleMaintenanceJob(workers, ANALYTICS_ROLLUP_JOB, ANALYTICS_ROLLUP_EVERY_MS);
}
