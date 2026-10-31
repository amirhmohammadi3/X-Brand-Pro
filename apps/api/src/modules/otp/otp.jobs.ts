import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { OtpService } from './otp.service.js';

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
 */
export function registerOtpJobs(workers: WorkersService, otp: OtpService): void {
  workers.register(MAINTENANCE_QUEUE, async (job) => {
    if (job.name !== OTP_CLEANUP_JOB) return;
    const deleted = await otp.cleanupExpired();
    if (deleted > 0) {
      logger.log(`otp:cleanup deleted ${deleted} expired otp_codes row(s)`);
    }
  });
  workers.registerRepeatable(MAINTENANCE_QUEUE, OTP_CLEANUP_JOB, {}, OTP_CLEANUP_EVERY_MS);
}
