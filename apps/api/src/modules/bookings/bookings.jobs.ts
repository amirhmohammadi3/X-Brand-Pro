import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { BookingsService } from './bookings.service.js';
import {
  registerMaintenanceHandler,
  scheduleMaintenanceJob,
} from '../../queue/maintenance.jobs.js';

/** Queue name for housekeeping jobs (B1.4). Domain modules share it. */
export const MAINTENANCE_QUEUE = 'maintenance';
/** Stamps + emits `booking.reminder` for slots inside the lead window. */
export const BOOKING_REMINDER_JOB = 'bookings:reminders';
export const BOOKING_REMINDER_EVERY_MS = 15 * 60 * 1000;

const logger = new Logger('BookingJobs');

/**
 * Worker-side registration (B6.3), following the otp.jobs.ts pattern:
 * registration is inert in the API process (startAll() only runs in the
 * worker) and idempotent across restarts (BullMQ dedupes the repeatable).
 */
export function registerBookingJobs(workers: WorkersService, bookings: BookingsService): void {
  registerMaintenanceHandler(BOOKING_REMINDER_JOB, async () => {
    const reminded = await bookings.runReminders();
    if (reminded > 0) {
      logger.log(`bookings:reminders stamped ${reminded} booking(s)`);
    }
  });
  scheduleMaintenanceJob(workers, BOOKING_REMINDER_JOB, BOOKING_REMINDER_EVERY_MS);
}
