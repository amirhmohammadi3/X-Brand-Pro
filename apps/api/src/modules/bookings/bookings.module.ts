import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BOOKINGS_REPOSITORY, BookingsRepository } from './bookings.repository.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

/**
 * Booking engine (B6.2): availability slots, the conflict-free create and
 * the user's own list — the storage reads live in this module (weekly
 * hours/special days are read directly, not via HoursModule's service, so
 * the engine sees raw schedule rows without the HTTP layer).
 *
 * EventEmitter2 is @Global; AuditModule is imported (not @Global) so the
 * controller can inject AUDIT_SERVICE. B6.3 wires the lifecycle + notify.
 */
@Module({
  imports: [AuditModule],
  controllers: [BookingsController],
  providers: [{ provide: BOOKINGS_REPOSITORY, useClass: BookingsRepository }, BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
