import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import {
  BOOKING_EVENTS,
  BOOKING_FEED_MAX_EVENTS,
  BOOKING_MAX_ACTIVE_PER_USER_PER_BUSINESS,
  BOOKING_REMINDER_LEAD_MINUTES,
  crossesMidnight,
  timeToMinutes,
  type AvailabilityResult,
  type Booking,
  type BookingService,
  type BookingSlot,
  type CreateBookingBody,
  type MyBookingsQuery,
  type MyBookingsResult,
} from '@app/contracts';
import {
  BOOKINGS_REPOSITORY,
  type BookingDetailRow,
  type BookingsRepositoryLike,
  type BookingServiceContext,
} from './bookings.repository.js';
import { canManageBusiness } from '../business/business-access.js';
import { ForbiddenException } from '@nestjs/common';
import { buildIcsCalendar, type IcsBooking } from './bookings.ics.js';

/**
 * Booking availability engine + conflict-free creation (B6.2). The rules:
 *
 * - **Window source:** the business's OWN schedule — weekly `business_hours`
 *   overridden by `business_special_days` for the date — exactly the B2.5
 *   semantics (special day replaces the day; a closed special day cancels
 *   the incoming tail). A midnight-crossing interval contributes its
 *   PRE-midnight part on its own date (slots must end by 24:00) and its
 *   tail as the NEXT date's early window, matching `computeOpenStatus`.
 * - **Closed days:** `booking_closed_days` (the private-event calendar) and
 *   closed special days both close booking for the date, independently of
 *   opening hours.
 * - **Grid:** slot starts are multiples of `slotStepMinutes` from midnight
 *   (a deterministic, timezone-free anchor); a slot fits when
 *   `start >= open` AND `start + duration <= close`.
 * - **Lead time:** slot instant (business-local wall clock → UTC via the
 *   two-pass `Intl` conversion) must be at least `minLeadMinutes` away.
 * - **Horizon:** dates beyond `today + maxAdvanceDays` (business-local
 *   today) answer `closed: true` — the calendar just shows no slots.
 * - **Capacity:** a booking occupies ONE unit regardless of party size
 *   (tables, not seats — v1, documented in the schema header). The create
 *   path re-counts under `pg_advisory_xact_lock(hashtext(service),
 *   hashtext(date))` inside the insert transaction, so two racing creators
 *   cannot both take the last table (B6.2's «تراکنش و قفل»).
 * - **404-never-leak:** a missing service, an inactive one, or one on a
 *   deleted/non-active business all answer the same 404.
 */

const DAY_MINUTES = 1440; // 24 * 60

/** The authenticated-actor shape (req.user) the lifecycle methods take. */
export type LifecycleActor = { id: string; role: string };

/** Unambiguous code alphabet (no I/O/0/1) — 8 chars, unique per business. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// ─── Timezone helpers (mirror hours.service — Intl only, no luxon) ────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const TZ_FORMATTER_OPTS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
} as const;

/** Resolve a UTC instant into the wall-clock parts of `timezone`. */
function formatInTz(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string;
  weekday: number; // ISO 1 Mon .. 7 Sun
} {
  const dtf = new Intl.DateTimeFormat('en-US', { ...TZ_FORMATTER_OPTS, timeZone: timezone });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    return v === undefined ? 0 : Number(v);
  };
  const hour = get('hour') % 24;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const minute = get('minute');
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekday = dow === 0 ? 7 : dow;
  return { year, month, day, hour, minute, dateStr, weekday };
}

/**
 * Offset (ms) of `timezone` from UTC at the given instant (positive east).
 */
function tzOffsetMs(timezone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', { ...TZ_FORMATTER_OPTS, timeZone: timezone });
  const parts = dtf.formatToParts(instant);
  const get = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    return v === undefined ? 0 : Number(v);
  };
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a local wall-clock (y/m/d, minutes-of-day in `timezone`) to a UTC
 * instant — the same two-pass conversion hours.service uses, correct across
 * DST boundaries.
 */
export function wallMinutesToInstant(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timezone: string,
): Date {
  const wallUtc = Date.UTC(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60);
  const off1 = tzOffsetMs(timezone, new Date(wallUtc));
  const real1 = wallUtc - off1;
  const off2 = tzOffsetMs(timezone, new Date(real1));
  return new Date(wallUtc - off2);
}

/** `YYYY-MM-DD` parts → a `Date.UTC` anchor (pure calendar math). */
function dateParts(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

/** Add N calendar days to a `YYYY-MM-DD` string (UTC anchor, no tz needed). */
export function addDays(dateStr: string, days: number): string {
  const { year, month, day } = dateParts(dateStr);
  const anchor = new Date(Date.UTC(year, month - 1, day + days));
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + 1;
  const d = anchor.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Shift a `YYYY-MM-DD` back one day (the engine's tail lookup). */
export function prevDay(dateStr: string): string {
  return addDays(dateStr, -1);
}

// ─── Pure slot engine ─────────────────────────────────────────────────────

/** A bookable window in minutes-of-day (`closeMin` may be 1440 = 24:00). */
export interface SlotWindow {
  openMin: number;
  closeMin: number;
}

export interface GenerateSlotsInput {
  windows: SlotWindow[];
  durationMinutes: number;
  slotStepMinutes: number;
  /** Active booking counts keyed by `HH:mm:ss` start (missing key = 0). */
  counts: Record<string, number>;
  capacity: number;
  /** Slots starting before this instant are unavailable (lead time / past). */
  minStartInstantMs: number;
  /** Wall-clock minutes of a start → its UTC instant (tz conversion). */
  startInstantMs: (startMin: number) => number;
}

/**
 * The pure engine (exported for tests): grid starts within each window,
 * `start + duration <= close`, not full (`counts[start] < capacity`), and
 * not before the lead cutoff. The DB time string is derived from the same
 * minutes so storage and DTOs always agree.
 */
export function generateSlots(input: GenerateSlotsInput): BookingSlot[] {
  const slots: BookingSlot[] = [];
  const seen = new Set<number>();
  for (const window of input.windows) {
    for (
      let startMin = Math.ceil(window.openMin / input.slotStepMinutes) * input.slotStepMinutes;
      startMin + input.durationMinutes <= window.closeMin;
      startMin += input.slotStepMinutes
    ) {
      if (startMin < window.openMin || seen.has(startMin)) continue;
      seen.add(startMin);
      const full = (input.counts[dbTime(startMin)] ?? 0) >= input.capacity;
      const tooSoon = input.startInstantMs(startMin) < input.minStartInstantMs;
      slots.push({ start: hhmm(startMin), available: !full && !tooSoon });
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/** Minutes-of-day → `HH:mm:ss` (the storage alphabet). */
export function dbTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}:00`;
}

/** Minutes-of-day → `HH:mm` (the DTO alphabet). */
export function hhmm(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** `HH:mm` → minutes-of-day. */
export function minutesOf(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// ─── Exceptions (mirror favorites.service shapes) ──────────────────────────

function notFoundException(): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: 'booking service not found',
      details: { entity: 'booking_service' },
    },
    HttpStatus.NOT_FOUND,
  );
}

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    { code: 'CONFLICT' as const, messageKey: 'errors.conflict', message, details },
    HttpStatus.CONFLICT,
  );
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE' as const, messageKey: 'errors.unprocessable', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(BOOKINGS_REPOSITORY) private readonly repo: BookingsRepositoryLike,
    private readonly events: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The effective bookable windows for one business-local date: the day's
   * own intervals (special-day override, else weekly) + the incoming tail
   * from the previous day's midnight-crossing intervals (cancelled when the
   * day itself is a closed special day). Crossing own intervals contribute
   * only their pre-midnight part (slots end by 24:00 — v1 rule).
   */
  private async resolveWindows(businessId: string, date: string): Promise<SlotWindow[]> {
    const prev = prevDay(date);
    const [weekly, specials] = await Promise.all([
      this.repo.findWeekly(businessId),
      this.repo.findSpecialDaysInRange(businessId, prev, date),
    ]);

    const ownSpecial = specials.find((d) => d.date === date) ?? null;
    const prevSpecial = specials.find((d) => d.date === prev) ?? null;

    const daySpecialClosed = ownSpecial?.closed === true;

    const windows: SlotWindow[] = [];
    if (daySpecialClosed) return windows;

    // The day's own schedule: a special day replaces the weekly plan entirely.
    const weekday = weekdayOf(date);
    const ownIntervals = ownSpecial
      ? (ownSpecial.intervals ?? [])
      : weeklyDayIntervalsOrEmpty(weekly, weekday);
    for (const iv of ownIntervals) {
      const openMin = timeToMinutes(iv.open);
      const closeMin = iv.close === '24:00' ? DAY_MINUTES : timeToMinutes(iv.close);
      // Crossing own interval (close < open): only the pre-midnight part is
      // bookable on its own date (v1 slots end by 24:00); the tail belongs
      // to the next date's early window.
      windows.push({ openMin, closeMin: closeMin <= openMin ? DAY_MINUTES : closeMin });
    }

    // Incoming tail from the previous day's midnight-crossing intervals.
    const prevIntervals = prevSpecial
      ? prevSpecial.closed
        ? []
        : (prevSpecial.intervals ?? [])
      : weeklyDayIntervalsOrEmpty(weekly, weekdayOf(prev));
    for (const iv of prevIntervals) {
      if (!crossesMidnight(iv)) continue;
      const closeMin = timeToMinutes(iv.close); // < 1440 for crossing intervals
      windows.push({ openMin: 0, closeMin });
    }
    return windows;
  }

  /**
   * GET /bookings/availability — the slots of one service-day. Closed days,
   * horizon/past dates and closed special days answer `closed: true` with
   * no slots (the calendar renders them as unbookable, not as an error).
   */
  async availability(serviceId: string, date: string): Promise<AvailabilityResult> {
    const ctx = await this.requireServiceContext(serviceId);
    const { service, business } = ctx;
    const tz = business.timezone;
    const now = new Date();
    const todayStr = formatInTz(now, tz).dateStr;

    const closedReason =
      date < todayStr ||
      date > addDays(todayStr, service.maxAdvanceDays) ||
      service.durationMinutes > DAY_MINUTES;

    if (closedReason) return { serviceId, date, closed: true, slots: [] };

    const closedDay = await this.repo.findClosedDay(service.businessId, date);
    const windows = closedDay ? [] : await this.resolveWindows(service.businessId, date);

    if (windows.length === 0) return { serviceId, date, closed: true, slots: [] };

    const counts = await this.repo.countActiveByStart(service.id, date);
    const { year, month, day } = dateParts(date);
    const slots = generateSlots({
      windows,
      durationMinutes: service.durationMinutes,
      slotStepMinutes: service.slotStepMinutes,
      counts,
      capacity: service.capacity,
      minStartInstantMs: now.getTime() + service.minLeadMinutes * 60_000,
      startInstantMs: (startMin) => wallMinutesToInstant(year, month, day, startMin, tz).getTime(),
    });
    return { serviceId, date, closed: false, slots };
  }

  /**
   * POST /bookings — the conflict-free create. Every rule failure is a
   * 422 with the reason in `details.reason` (the client renders the
   * matching message); the capacity race is a 409.
   */
  async create(userId: string, input: CreateBookingBody): Promise<BookingDetailRow> {
    const ctx = await this.requireServiceContext(input.serviceId);
    const { service, business } = ctx;
    const tz = business.timezone;
    const now = new Date();
    const todayStr = formatInTz(now, tz).dateStr;

    if (input.partySize < service.minPartySize || input.partySize > service.maxPartySize) {
      throw ruleException('party size outside the service bounds', {
        field: 'partySize',
        reason: 'party_size',
        min: service.minPartySize,
        max: service.maxPartySize,
      });
    }

    const activeCount = await this.repo.countUserActiveForBusiness(userId, service.businessId);
    if (activeCount >= BOOKING_MAX_ACTIVE_PER_USER_PER_BUSINESS) {
      throw conflictException('too many active bookings at this business', {
        reason: 'too_many_active',
        limit: BOOKING_MAX_ACTIVE_PER_USER_PER_BUSINESS,
      });
    }

    if (input.date < todayStr) {
      throw ruleException('the date is in the past', { field: 'date', reason: 'past' });
    }
    if (input.date > addDays(todayStr, service.maxAdvanceDays)) {
      throw ruleException('the date is beyond the booking horizon', {
        field: 'date',
        reason: 'horizon',
      });
    }
    const closedDay = await this.repo.findClosedDay(service.businessId, input.date);
    if (closedDay) {
      throw ruleException('booking is closed for this date', {
        field: 'date',
        reason: 'closed_day',
      });
    }

    const windows = await this.resolveWindows(service.businessId, input.date);
    const startMin = minutesOf(input.startTime);
    if (startMin % service.slotStepMinutes !== 0) {
      throw ruleException('start time is off the slot grid', {
        field: 'startTime',
        reason: 'grid',
        step: service.slotStepMinutes,
      });
    }
    const endMin = startMin + service.durationMinutes;
    const window = windows.find((w) => startMin >= w.openMin && endMin <= w.closeMin);
    if (!window) {
      throw ruleException('the slot does not fit the opening hours', {
        field: 'startTime',
        reason: 'outside_hours',
      });
    }

    const { year, month, day } = dateParts(input.date);
    const startInstant = wallMinutesToInstant(year, month, day, startMin, tz).getTime();
    const minInstant = now.getTime() + service.minLeadMinutes * 60_000;
    if (startInstant < minInstant) {
      throw ruleException('the slot is inside the minimum lead time', {
        field: 'startTime',
        reason: 'lead_time',
      });
    }

    const base = {
      businessId: service.businessId,
      serviceId: service.id,
      userId,
      date: input.date,
      startTime: dbTime(startMin),
      endTime: dbTime(endMin),
      partySize: input.partySize,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      note: input.note ?? null,
    };

    // The unique code has ~85^8 combinations; the (business, code) race is
    // a bounded retry, the capacity race is a definitive 409.
    let lastOutcome: 'code_conflict' | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = await this.repo.createBookingTx({
        ...base,
        code: generateCode(),
        capacity: service.capacity,
      });
      if (outcome.ok) {
        this.events.emit(BOOKING_EVENTS.created, {
          bookingId: outcome.row.id,
          userId,
          businessId: service.businessId,
          serviceId: service.id,
          date: input.date,
          startTime: outcome.row.startTime,
          partySize: input.partySize,
        });
        return {
          ...outcome.row,
          serviceName: service.name,
          businessName: business.name,
          businessSlug: business.slug,
          businessOwnerId: business.ownerId,
          businessStatus: business.status,
          timezone: tz,
          cancelWindowMinutes: service.cancelWindowMinutes,
        };
      }
      if (outcome.reason === 'slot_full') {
        throw conflictException('the slot is full', { reason: 'slot_full' });
      }
      lastOutcome = outcome.reason;
    }
    throw new HttpException(
      {
        code: 'INTERNAL' as const,
        messageKey: 'errors.internal',
        message: `could not allocate a booking code (${lastOutcome})`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ─── Lifecycle (B6.3) ────────────────────────────────────────────────────

  /** The authenticated-actor shape (req.user) the lifecycle methods take. */

  /**
   * POST /bookings/:id/decision — the OWNER confirms or rejects a pending
   * booking. Guarded UPDATE against `pending` so a racing user-cancel wins
   * once (the loser sees 409, never a silent overwrite).
   */
  async decide(
    actor: LifecycleActor,
    bookingId: string,
    action: 'confirm' | 'reject',
    reason?: string,
  ): Promise<Booking> {
    const booking = await this.requireManagedBooking(actor, bookingId);
    const now = new Date();
    const next = action === 'confirm' ? 'confirmed' : 'rejected';
    const row = await this.repo.transitionStatus(
      bookingId,
      ['pending'],
      action === 'confirm'
        ? { status: next, confirmedAt: now }
        : { status: next, rejectedAt: now, cancelReason: reason ?? null },
    );
    if (!row) {
      throw conflictException('the booking is no longer pending', { reason: 'stale_status' });
    }
    this.events.emit(action === 'confirm' ? BOOKING_EVENTS.confirmed : BOOKING_EVENTS.rejected, {
      bookingId,
      userId: booking.userId,
      businessId: booking.businessId,
      date: booking.date,
      startTime: booking.startTime,
    });
    return this.toBookingDto(row);
  }

  /**
   * POST /bookings/:id/cancel — the booking's USER (inside the service's
   * cancel window, B6.3 سیاست لغو) or the business OWNER (any time) moves
   * pending/confirmed → cancelled. A stranger gets the same 404 as a
   * missing booking (404-never-leak).
   */
  async cancel(actor: LifecycleActor, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.requireExistingBooking(bookingId);
    const isBookingUser = booking.userId === actor.id;
    const isManager = canManageBusiness(actor, {
      ownerId: booking.businessOwnerId,
      status: booking.businessStatus as never,
    });
    if (!isBookingUser && !isManager) throw notFoundException();

    if (isBookingUser && !isManager) {
      // User-side policy: free cancel only while start − window is ahead.
      const { year, month, day } = dateParts(booking.date);
      const startInstant = wallMinutesToInstant(
        year,
        month,
        day,
        minutesOf(booking.startTime.slice(0, 5)),
        booking.timezone,
      ).getTime();
      const freeUntil = startInstant - booking.cancelWindowMinutes * 60_000;
      if (Date.now() >= freeUntil) {
        throw ruleException('the free cancellation window has passed', {
          reason: 'cancel_window',
          cancelWindowMinutes: booking.cancelWindowMinutes,
        });
      }
    }

    const now = new Date();
    const row = await this.repo.transitionStatus(bookingId, ['pending', 'confirmed'], {
      status: 'cancelled',
      cancelledAt: now,
      cancelActor: isManager && !isBookingUser ? 'business' : 'user',
      cancelReason: reason ?? null,
    });
    if (!row) {
      throw conflictException('the booking is no longer active', { reason: 'stale_status' });
    }
    this.events.emit(BOOKING_EVENTS.cancelled, {
      bookingId,
      userId: booking.userId,
      businessId: booking.businessId,
      cancelledBy: isManager && !isBookingUser ? 'business' : 'user',
    });
    return this.toBookingDto(row);
  }

  /** POST /bookings/:id/no-show — owner marks a confirmed no-show (owner side). */
  async markNoShow(actor: LifecycleActor, bookingId: string): Promise<Booking> {
    await this.requireManagedBooking(actor, bookingId);
    const row = await this.repo.transitionStatus(bookingId, ['confirmed'], {
      status: 'no_show',
      noShowAt: new Date(),
    });
    if (!row) {
      throw conflictException('only confirmed bookings can be marked no-show', {
        reason: 'stale_status',
      });
    }
    this.events.emit(BOOKING_EVENTS.noShow, {
      bookingId,
      userId: row.userId,
      businessId: row.businessId,
    });
    return this.toBookingDto(row);
  }

  /** POST /bookings/:id/complete — owner closes out a confirmed booking. */
  async complete(actor: LifecycleActor, bookingId: string): Promise<Booking> {
    await this.requireManagedBooking(actor, bookingId);
    const row = await this.repo.transitionStatus(bookingId, ['confirmed'], {
      status: 'completed',
      completedAt: new Date(),
    });
    if (!row) {
      throw conflictException('only confirmed bookings can be completed', {
        reason: 'stale_status',
      });
    }
    this.events.emit(BOOKING_EVENTS.completed, {
      bookingId,
      userId: row.userId,
      businessId: row.businessId,
    });
    return this.toBookingDto(row);
  }

  /**
   * The reminder pass (B6.3 یادآوری) — the maintenance job's handler.
   * Stamps `reminder_sent_at` on every active booking whose business-local
   * start falls inside the next BOOKING_REMINDER_LEAD_MINUTES and emits
   * `booking.reminder` per row (notify wiring arrives with the catalog).
   * The scan anchors on Tehran today/tomorrow, then filters per business
   * timezone — date+start are wall clock, "due" is an instant comparison.
   */
  async runReminders(): Promise<number> {
    const now = new Date();
    const today = formatInTz(now, 'Asia/Tehran').dateStr;
    const candidates = await this.repo.findReminderCandidates(today, addDays(today, 1));
    const leadMs = BOOKING_REMINDER_LEAD_MINUTES * 60_000;
    const due = candidates.filter((c) => {
      const { year, month, day } = dateParts(c.date);
      const startInstant = wallMinutesToInstant(
        year,
        month,
        day,
        minutesOf(c.startTime.slice(0, 5)),
        c.timezone,
      ).getTime();
      return startInstant > now.getTime() && startInstant - now.getTime() <= leadMs;
    });
    if (due.length === 0) return 0;
    await this.repo.stampReminderSent(due.map((c) => c.id));
    for (const c of due) {
      this.events.emit(BOOKING_EVENTS.reminder, {
        bookingId: c.id,
        userId: c.userId,
        businessId: c.businessId,
        date: c.date,
        startTime: c.startTime,
      });
    }
    return due.length;
  }

  // ─── ICS calendar feed (B6.4) ───────────────────────────────────────────

  /**
   * The feed token: HMAC-SHA256 over `calendar-feed:<scope>:<id>` with the
   * OTP HMAC secret, hex-truncated to 32 chars. Stateless (no storage, no
   * revocation list) — rotating the secret kills every feed at once, which
   * is the right granularity for a personal calendar URL.
   */
  private feedToken(scope: 'user' | 'business', id: string): string {
    return createHmac('sha256', this.config.otpHmacSecret)
      .update(`calendar-feed:${scope}:${id}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** Constant-time token check; a wrong/garbage token answers 404-shaped 403. */
  private verifyFeedToken(scope: 'user' | 'business', id: string, token: string): boolean {
    const expected = Buffer.from(this.feedToken(scope, id));
    const provided = Buffer.from(token);
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  }

  /** GET /bookings/me/calendar-token (authenticated) — the user's feed URL token. */
  userFeedTokenFor(userId: string): string {
    return this.feedToken('user', userId);
  }

  /** GET /bookings/business/:id/calendar-token (owner) — the owner feed token. */
  async businessFeedTokenFor(actor: LifecycleActor, businessId: string): Promise<string> {
    await this.verifyBusinessOwner(actor, businessId);
    return this.feedToken('business', businessId);
  }

  /** GET /bookings/me/calendar.ics?token=… — the user's calendar (public + token). */
  async userIcs(userId: string, token: string): Promise<string> {
    if (!this.verifyFeedToken('user', userId, token)) {
      throw new ForbiddenException();
    }
    const rows = await this.repo.listUserFeedBookings(userId, BOOKING_FEED_MAX_EVENTS);
    return buildIcsCalendar(
      rows.map((row) => this.toIcsBooking(row)),
      'رزروهای من',
    );
  }

  /** GET /bookings/business/:id/calendar.ics?token=… — the owner's calendar. */
  async businessIcs(businessId: string, token: string): Promise<string> {
    if (!this.verifyFeedToken('business', businessId, token)) {
      throw new ForbiddenException();
    }
    const rows = await this.repo.listBusinessFeedBookings(businessId, BOOKING_FEED_MAX_EVENTS);
    const calName = rows[0]?.businessName ?? 'رزروهای کسب‌وکار';
    return buildIcsCalendar(
      rows.map((row) => this.toIcsBooking(row)),
      calName,
    );
  }

  /** Wall clock (row's city timezone) → the UTC stamps the builder needs. */
  private toIcsBooking(row: BookingDetailRow): IcsBooking {
    const toUtc = (time: string): string => {
      const { year, month, day } = dateParts(row.date);
      const instant = wallMinutesToInstant(
        year,
        month,
        day,
        minutesOf(time.slice(0, 5)),
        row.timezone,
      );
      return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    };
    return {
      id: row.id,
      startUtc: toUtc(row.startTime),
      endUtc: toUtc(row.endTime),
      status: row.status,
      partySize: row.partySize,
      code: row.code,
      note: row.note,
      serviceName: row.serviceName,
      businessName: row.businessName,
    };
  }

  /** Owner gate for the business feed token (throws 403/404). */
  private async verifyBusinessOwner(actor: LifecycleActor, businessId: string): Promise<void> {
    const ctx = await this.repo.findBusinessContext(businessId);
    if (!ctx) throw notFoundException();
    if (
      !canManageBusiness(actor, {
        ownerId: ctx.ownerId,
        status: ctx.status as never,
      })
    ) {
      throw new ForbiddenException();
    }
  }

  /** 404 unless the booking exists; 403 unless the actor manages its business. */
  private async requireManagedBooking(
    actor: LifecycleActor,
    bookingId: string,
  ): Promise<BookingDetailRow> {
    const booking = await this.requireExistingBooking(bookingId);
    if (
      !canManageBusiness(actor, {
        ownerId: booking.businessOwnerId,
        status: booking.businessStatus as never,
      })
    ) {
      throw new ForbiddenException();
    }
    return booking;
  }

  /** 404-never-leak for a bare booking id. */
  private async requireExistingBooking(bookingId: string): Promise<BookingDetailRow> {
    const booking = await this.repo.findBookingDetail(bookingId);
    if (!booking) throw notFoundException();
    return booking;
  }

  /**
   * GET /bookings/services?businessId=… — the business's ACTIVE bookable
   * services (public — the booking flow's first step, F6.1). 404-never-leak:
   * a missing/deleted/non-active business answers the same 404.
   */
  async listPublicServices(businessId: string): Promise<BookingService[]> {
    const ctx = await this.repo.findBusinessContext(businessId);
    if (!ctx || ctx.deletedAt !== null || ctx.status !== 'active') {
      throw notFoundException();
    }
    const rows = await this.repo.listActiveServices(businessId);
    return rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      description: row.description,
      durationMinutes: row.durationMinutes,
      slotStepMinutes: row.slotStepMinutes,
      capacity: row.capacity,
      minPartySize: row.minPartySize,
      maxPartySize: row.maxPartySize,
      minLeadMinutes: row.minLeadMinutes,
      cancelWindowMinutes: row.cancelWindowMinutes,
      maxAdvanceDays: row.maxAdvanceDays,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** GET /bookings/me — the user's bookings, newest first. The scope split
   * (upcoming = active AND not started) is computed against the business-
   * local wall clock; rows carry the display joins for the list UI (F6.2).
   */
  async listMine(userId: string, query: MyBookingsQuery): Promise<MyBookingsResult> {
    // The scope clock uses Asia/Tehran directly: rows may belong to several
    // businesses (cities), and one shared reference clock keeps the split
    // deterministic for the user's own list.
    const now = new Date();
    const local = formatInTz(now, 'Asia/Tehran');
    const today = local.dateStr;
    const nowTime = `${pad2(local.hour)}:${pad2(local.minute)}:00`;

    const page = await this.repo.listUserBookings(userId, {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      scope: query.scope,
      today,
      nowTime,
    });
    return {
      bookings: page.rows.map((row) => this.toBookingDto(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  /** Shared 404-never-leak gate: exists + active business + active service. */
  private async requireServiceContext(serviceId: string): Promise<BookingServiceContext> {
    const ctx = await this.repo.findServiceContext(serviceId);
    if (
      !ctx ||
      ctx.business.deletedAt !== null ||
      ctx.business.status !== 'active' ||
      !ctx.service.isActive
    ) {
      throw notFoundException();
    }
    return ctx;
  }

  /** The wire shape (contracts bookingSchema) of a detail row. */
  toBookingDto(row: BookingDetailRow): Booking {
    return {
      id: row.id,
      businessId: row.businessId,
      serviceId: row.serviceId,
      userId: row.userId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      partySize: row.partySize,
      status: row.status,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      note: row.note,
      code: row.code,
      cancelActor: row.cancelActor,
      cancelReason: row.cancelReason,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      serviceName: row.serviceName,
      businessName: row.businessName,
      businessSlug: row.businessSlug,
    };
  }
}

/** ISO weekday (1 Mon .. 7 Sun) of a `YYYY-MM-DD` calendar date. */
function weekdayOf(date: string): number {
  const { year, month, day } = dateParts(date);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function weeklyDayIntervalsOrEmpty(
  weekly: Array<{
    weekday: number;
    allDay?: boolean;
    intervals?: Array<{ open: string; close: string }>;
  }>,
  weekday: number,
): Array<{ open: string; close: string }> {
  const entry = weekly.find((w) => w.weekday === weekday);
  if (!entry) return [];
  if (entry.allDay === true) return [{ open: '00:00', close: '24:00' }];
  return entry.intervals ?? [];
}
