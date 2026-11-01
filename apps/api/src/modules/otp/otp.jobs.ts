import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { OtpService } from './otp.service.js';
import {
  registerMaintenanceHandler,
  scheduleMaintenanceJob,
} from '../../queue/maintenance.jobs.js';

/** Queue name for housekeeping jobs (B1.4). Domain modules share it. */
export const MAINTENANCE_QUEUE = 'maintenance';
/** Deletes otp_codes rows expired more than 1 day ago, every 10 minutes. */
export const OTP_CLEANUP_JOB = 'otp:cleanup';
export const OTP_CLEANUP_EVERY_MS = 10 * 60 * 1000;

const logger = new Logger('OtpJobs');

/**
 * Worker-side registration (B1.4). Called from OtpModule's onModuleInit —
 * registration is inert in the API process (startAll() only runs in the
 * worker), and idempotent across restarts (BullMQ dedupes the repeatable).
 *
 * B1.14: the single `maintenance` processor moved to the shared dispatcher
 * (src/queue/maintenance.jobs.ts) — multiple prompts add repeatables to this
 * queue, and WorkersService enforces one processor per queue. Otp jobs now
 * register a named HANDLER + repeatable instead of the raw processor.
 */
export function registerOtpJobs(workers: WorkersService, otp: OtpService): void {
  registerMaintenanceHandler(OTP_CLEANUP_JOB, async () => {
    const deleted = await otp.cleanupExpired();
    if (deleted > 0) {
      logger.log(`otp:cleanup deleted ${deleted} expired otp_codes row(s)`);
    }
  });
  scheduleMaintenanceJob(workers, OTP_CLEANUP_JOB, OTP_CLEANUP_EVERY_MS);
}
