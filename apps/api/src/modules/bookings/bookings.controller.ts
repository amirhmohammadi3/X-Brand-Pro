import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  BOOKING_READ_LIMIT_PER_MIN,
  BOOKING_WRITE_LIMIT_PER_MIN,
  availabilityQuerySchema,
  createBookingBodySchema,
  myBookingsQuerySchema,
  type AvailabilityQuery,
  type AvailabilityResult,
  type CreateBookingBody,
  type CreateBookingResult,
  type MyBookingsQuery,
  type MyBookingsResult,
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

/**
 * Booking endpoints (B6.2 — engine + create + my list; B6.3 adds the
 * lifecycle transitions and owner calendar).
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
}
