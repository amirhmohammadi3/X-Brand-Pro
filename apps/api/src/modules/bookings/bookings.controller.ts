import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  BOOKING_FEED_LIMIT_PER_MIN,
  BOOKING_READ_LIMIT_PER_MIN,
  BOOKING_WRITE_LIMIT_PER_MIN,
  availabilityQuerySchema,
  bookingDecisionBodySchema,
  bookingRejectBodySchema,
  calendarFeedQuerySchema,
  businessServicesQuerySchema,
  createBookingBodySchema,
  createBookingClosedDayBodySchema,
  createBookingServiceBodySchema,
  myBookingsQuerySchema,
  ownerBookingsQuerySchema,
  updateBookingServiceBodySchema,
  type AvailabilityQuery,
  type AvailabilityResult,
  type Booking,
  type BookingDecisionBody,
  type BookingRejectBody,
  type CalendarFeedQuery,
  type BusinessServicesQuery,
  type BusinessServicesResult,
  type BookingClosedDaysResult,
  type CreateBookingBody,
  type CreateBookingClosedDayBody,
  type CreateBookingClosedDayResult,
  type CreateBookingResult,
  type CreateBookingServiceBody,
  type CreateBookingServiceResult,
  type DeleteBookingClosedDayResult,
  type MyBookingsQuery,
  type MyBookingsResult,
  type OwnerBookingsQuery,
  type OwnerBookingsResult,
  type OwnerBookingServicesResult,
  type UpdateBookingServiceBody,
  type UpdateBookingServiceResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BookingsService } from './bookings.service.js';

/** The req.user shape set by JwtAuthGuard. */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/** Actor + request info for the audit row (mirrors favorites.controller). */
function auditInfo(req: Request): {
  actor: { id: string | null; role: string | null };
  request: { ip: string | null; userAgent: string | null; requestId: string | null };
} {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  const ua = req.headers['user-agent'];
  const rid = req.headers['x-request-id'];
  return {
    actor: { id: user?.id ?? null, role: user?.role ?? null },
    request: {
      ip: req.ip ?? null,
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      requestId: typeof rid === 'string' ? rid : null,
    },
  };
}

/** Path params must be UUIDs — a garbage id answers 422, never a 500 from the DB. */
function assertUuid(raw: string, what: string): string {
  if (!uuidSchema.safeParse(raw).success) {
    throw new UnprocessableEntityException({
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message: `${what} must be a UUID`,
      details: { [what]: raw },
    });
  }
  return raw;
}

/**
 * Booking endpoints (B6.2 engine + create + my list; B6.3 lifecycle).
 *
 * Route layout:
 * - GET /bookings/availability?serviceId&date — public (the calendar shows
 *   slots before login), ip-scoped 60/min;
 * - POST /bookings             — authenticated, 20/min, audited;
 * - GET  /bookings/me          — authenticated, 60/min.
 */
@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  @Public()
  @Get('bookings/availability')
  @RateLimit({ name: 'bookings.availability', limit: BOOKING_READ_LIMIT_PER_MIN, windowSec: 60 })
  async availability(
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ): Promise<AvailabilityResult> {
    return this.bookings.availability(query.serviceId, query.date);
  }

  @Public()
  @Get('bookings/services')
  @RateLimit({ name: 'bookings.availability', limit: BOOKING_READ_LIMIT_PER_MIN, windowSec: 60 })
  async listServices(
    @Query(new ZodValidationPipe(businessServicesQuerySchema)) query: BusinessServicesQuery,
  ): Promise<BusinessServicesResult> {
    const services = await this.bookings.listPublicServices(query.businessId);
    return { services };
  }

  @Get('bookings/me')
  @RateLimit({
    name: 'bookings.read',
    limit: BOOKING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listMine(
    @Req() req: Request,
    @Query(new ZodValidationPipe(myBookingsQuerySchema)) query: MyBookingsQuery,
  ): Promise<MyBookingsResult> {
    const user = requireUser(req);
    return this.bookings.listMine(user.id, query);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  @Post('bookings')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createBookingBodySchema)) body: CreateBookingBody,
  ): Promise<CreateBookingResult> {
    const user = requireUser(req);
    const booking = await this.bookings.create(user.id, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking.create',
      entityType: 'booking',
      entityId: booking.id,
      after: {
        businessId: booking.businessId,
        serviceId: booking.serviceId,
        date: booking.date,
        startTime: booking.startTime,
        partySize: booking.partySize,
        code: booking.code,
      },
      request,
    });
    return { booking: this.bookings.toBookingDto(booking) };
  }

  // ─── Lifecycle (B6.3) ──────────────────────────────────────────────────

  /** POST /bookings/:id/decision — owner confirm/reject (audited). */
  @Post('bookings/:id/decision')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async decide(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bookingDecisionBodySchema)) body: BookingDecisionBody,
  ): Promise<{ booking: Booking }> {
    const user = requireUser(req);
    const booking = await this.bookings.decide(
      user,
      assertUuid(id, 'bookingId'),
      body.action,
      body.reason,
    );
    this.auditLog(req, 'booking.decision', booking, { action: body.action });
    return { booking };
  }

  /** POST /bookings/:id/cancel — the booking's user (policy window) or owner. */
  @Post('bookings/:id/cancel')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bookingRejectBodySchema)) body: BookingRejectBody,
  ): Promise<{ booking: Booking }> {
    const user = requireUser(req);
    const booking = await this.bookings.cancel(user, assertUuid(id, 'bookingId'), body.reason);
    this.auditLog(req, 'booking.cancel', booking, null);
    return { booking };
  }

  /** POST /bookings/:id/no-show — owner marks a confirmed booking no-show. */
  @Post('bookings/:id/no-show')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async noShow(@Req() req: Request, @Param('id') id: string): Promise<{ booking: Booking }> {
    const user = requireUser(req);
    const booking = await this.bookings.markNoShow(user, assertUuid(id, 'bookingId'));
    this.auditLog(req, 'booking.no_show', booking, null);
    return { booking };
  }

  /** POST /bookings/:id/complete — owner closes out a confirmed booking. */
  @Post('bookings/:id/complete')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async complete(@Req() req: Request, @Param('id') id: string): Promise<{ booking: Booking }> {
    const user = requireUser(req);
    const booking = await this.bookings.complete(user, assertUuid(id, 'bookingId'));
    this.auditLog(req, 'booking.complete', booking, null);
    return { booking };
  }

  /** Shared audit row for the lifecycle writes. */
  private auditLog(
    req: Request,
    action: string,
    booking: Booking,
    after: Record<string, unknown> | null,
  ): void {
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action,
      entityType: 'booking',
      entityId: booking.id,
      after: {
        status: booking.status,
        cancelActor: booking.cancelActor,
        ...(after ?? {}),
      },
      request,
    });
  }

  // ─── F7.5 — owner booking settings + reservation calendar ──────────────

  /** GET /bookings/services/owner/:businessId — every service (incl. inactive). */
  @Get('bookings/services/owner/:businessId')
  @RateLimit({
    name: 'bookings.read',
    limit: BOOKING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listOwnerServices(
    @Req() req: Request,
    @Param('businessId') businessId: string,
  ): Promise<OwnerBookingServicesResult> {
    const user = requireUser(req);
    const services = await this.bookings.listOwnerServices(
      user,
      assertUuid(businessId, 'businessId'),
    );
    return { services };
  }

  /** POST /bookings/services/:businessId — create one bookable service. */
  @Post('bookings/services/:businessId')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async createOwnerService(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(createBookingServiceBodySchema)) body: CreateBookingServiceBody,
  ): Promise<CreateBookingServiceResult> {
    const user = requireUser(req);
    const result = await this.bookings.createOwnerService(
      user,
      assertUuid(businessId, 'businessId'),
      body,
    );
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking_service.create',
      entityType: 'booking_service',
      entityId: result.service.id,
      after: {
        businessId: result.service.businessId,
        name: result.service.name,
        isActive: result.service.isActive,
      },
      request,
    });
    return result;
  }

  /** PATCH /bookings/services/:id — update one service's fields. */
  @Post('bookings/services/:id')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async updateOwnerService(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBookingServiceBodySchema)) body: UpdateBookingServiceBody,
  ): Promise<UpdateBookingServiceResult> {
    const user = requireUser(req);
    const result = await this.bookings.updateOwnerService(user, assertUuid(id, 'serviceId'), body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking_service.update',
      entityType: 'booking_service',
      entityId: result.service.id,
      after: body,
      request,
    });
    return result;
  }

  /** DELETE /bookings/services/:id — remove a service (cascades its bookings). */
  @Delete('bookings/services/:id')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOwnerService(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const user = requireUser(req);
    await this.bookings.deleteOwnerService(user, assertUuid(id, 'serviceId'));
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking_service.delete',
      entityType: 'booking_service',
      entityId: id,
      after: null,
      request,
    });
  }

  /** GET /bookings/closed-days/:businessId — the business's booking closures. */
  @Get('bookings/closed-days/:businessId')
  @RateLimit({
    name: 'bookings.read',
    limit: BOOKING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listClosedDays(
    @Req() req: Request,
    @Param('businessId') businessId: string,
  ): Promise<BookingClosedDaysResult> {
    const user = requireUser(req);
    const days = await this.bookings.listClosedDays(user, assertUuid(businessId, 'businessId'));
    return { days };
  }

  /** POST /bookings/closed-days/:businessId — add a full-day booking closure. */
  @Post('bookings/closed-days/:businessId')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async createClosedDay(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(createBookingClosedDayBodySchema)) body: CreateBookingClosedDayBody,
  ): Promise<CreateBookingClosedDayResult> {
    const user = requireUser(req);
    const result = await this.bookings.createClosedDay(
      user,
      assertUuid(businessId, 'businessId'),
      body,
    );
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking_closed_day.create',
      entityType: 'booking_closed_day',
      entityId: result.day.id,
      after: { businessId: result.day.businessId, date: result.day.date },
      request,
    });
    return result;
  }

  /** DELETE /bookings/closed-days/:businessId/:date — idempotent removal. */
  @Delete('bookings/closed-days/:businessId/:date')
  @RateLimit({
    name: 'bookings.write',
    limit: BOOKING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async deleteClosedDay(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Param('date') date: string,
  ): Promise<DeleteBookingClosedDayResult> {
    const user = requireUser(req);
    const result = await this.bookings.deleteClosedDay(
      user,
      assertUuid(businessId, 'businessId'),
      date,
    );
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'booking_closed_day.delete',
      entityType: 'booking_closed_day',
      entityId: `${businessId}:${date}`,
      after: { date },
      request,
    });
    return result;
  }

  /** GET /bookings/business/:businessId — the owner calendar (one page). */
  @Get('bookings/business/:businessId')
  @RateLimit({
    name: 'bookings.read',
    limit: BOOKING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listOwnerBookings(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Query(new ZodValidationPipe(ownerBookingsQuerySchema)) query: OwnerBookingsQuery,
  ): Promise<OwnerBookingsResult> {
    const user = requireUser(req);
    return this.bookings.listOwnerBookings(user, assertUuid(businessId, 'businessId'), query);
  }

  // ─── ICS calendar feed (B6.4) ──────────────────────────────────────────

  /** GET /bookings/me/calendar-token — the subscriber's private feed token. */
  @Get('bookings/me/calendar-token')
  @RateLimit({
    name: 'bookings.feed',
    limit: BOOKING_FEED_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async myFeedToken(@Req() req: Request): Promise<{ token: string }> {
    const user = requireUser(req);
    return { token: this.bookings.userFeedTokenFor(user.id) };
  }

  /** GET /bookings/business/:id/calendar-token — the owner's feed token. */
  @Get('bookings/business/:id/calendar-token')
  @RateLimit({
    name: 'bookings.feed',
    limit: BOOKING_FEED_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async businessFeedToken(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ token: string }> {
    const user = requireUser(req);
    const token = await this.bookings.businessFeedTokenFor(user, assertUuid(id, 'businessId'));
    return { token };
  }

  /** GET /bookings/user/:id/calendar.ics?token=… — public feed (token = auth). */
  @Public()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Get('bookings/user/:id/calendar.ics')
  @RateLimit({
    name: 'bookings.feed',
    limit: BOOKING_FEED_LIMIT_PER_MIN,
    windowSec: 60,
  })
  async userIcs(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(calendarFeedQuerySchema)) query: CalendarFeedQuery,
  ): Promise<string> {
    return this.bookings.userIcs(assertUuid(id, 'userId'), query.token);
  }

  /** GET /bookings/business/:id/calendar.ics?token=… — public owner feed. */
  @Public()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Get('bookings/business/:id/calendar.ics')
  @RateLimit({
    name: 'bookings.feed',
    limit: BOOKING_FEED_LIMIT_PER_MIN,
    windowSec: 60,
  })
  async businessIcs(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(calendarFeedQuerySchema)) query: CalendarFeedQuery,
  ): Promise<string> {
    return this.bookings.businessIcs(assertUuid(id, 'businessId'), query.token);
  }
}
