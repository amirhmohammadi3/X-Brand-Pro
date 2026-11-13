import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomInt } from 'node:crypto';
import {
  BOOKING_EVENTS,
  BOOKING_MAX_ACTIVE_PER_USER_PER_BUSINESS,
  crossesMidnight,
  timeToMinutes,
  type AvailabilityResult,
  type Booking,
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

export const BOOKING_EVENTS_EXPORTED = BOOKING_EVENTS;

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

  /**
   * GET /bookings/me — the user's bookings, newest first. The scope split
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
