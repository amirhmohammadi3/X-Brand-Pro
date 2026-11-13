import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { BOOKINGS_REPOSITORY, BookingsRepository } from './bookings.repository.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { registerBookingJobs } from './bookings.jobs.js';

/**
 * Booking engine + lifecycle (B6.2/B6.3): availability slots, the
 * conflict-free create, the user's own list and the status transitions
 * (confirm/reject/cancel/no-show/complete) with the cancellation policy and
 * the reminder repeatable. The storage reads live in this module (weekly
 * hours/special days are read directly, not via HoursModule's service, so
 * the engine sees raw schedule rows without the HTTP layer).
 *
 * EventEmitter2 is @Global; AuditModule is imported (not @Global) so the
 * controller can inject AUDIT_SERVICE. The reminder job fires from the
 * shared `maintenance` dispatcher (worker-only); the booking.* domain
 * events are consumed by the notifications subscriber when its catalog
 * grows booking keys.
 */
@Injectable()
export class BookingsJobsInit implements OnModuleInit {
  constructor(
    private readonly bookings: BookingsService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerBookingJobs(this.workers, this.bookings);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [BookingsController],
  providers: [
    { provide: BOOKINGS_REPOSITORY, useClass: BookingsRepository },
    BookingsService,
    BookingsJobsInit,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
