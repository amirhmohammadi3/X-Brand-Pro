import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type HoursResponse,
  type Interval,
  type OpenState,
  type OpenStatus,
  type SpecialDay,
  type UpsertSpecialDayBody,
  type WeeklyDay,
  type WeeklyHours,
  crossesMidnight,
  timeToMinutes,
} from '@app/contracts';
import { BUSINESSES_REPOSITORY, type BusinessesRepositoryLike } from '../businesses.repository.js';
import { HOURS_REPOSITORY, type HoursRepositoryLike } from './hours.repository.js';

/**
 * Business opening-hours service (B2.5). Owns the weekly schedule + special-day
 * CRUD and the pure `computeOpenStatus` "open now" computation. The HTTP layer
 * (hours.controller) loads a business context (existence + city timezone) and
 * delegates here; authorization lives in `business-access.ts`.
 */

const DAY_MINUTES = 1440; // 24 * 60

// ─── Timezone helpers (no luxon/moment — Intl.DateTimeFormat only) ────────

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string;
  weekday: number; // ISO 1 Mon .. 7 Sun
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const TZ_FORMATTER_OPTS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
} as const;

/** Resolve a UTC instant into the wall-clock parts of `timezone`. */
function formatInTz(date: Date, timezone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', { ...TZ_FORMATTER_OPTS, timeZone: timezone });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    return v === undefined ? 0 : Number(v);
  };
  const hour = get('hour') % 24; // hour12:false yields '24' at midnight
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const minute = get('minute');
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  // ISO weekday of the local calendar date. Date.UTC(y, m-1, d).getUTCDay() is
  // 0 Sun..6 Sat (pure calendar math, no tz involved).
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekday = dow === 0 ? 7 : dow;
  return { year, month, day, hour, minute, dateStr, weekday };
}

/**
 * Offset (ms) of `timezone` from UTC at the given instant: tz wall clock read
 * back as UTC minus the instant. Positive east of UTC.
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
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a local wall-clock (y/m/d h:min in `timezone`) to a UTC instant,
 * correct across DST boundaries. Two-pass: compute the offset assuming the
 * naive UTC instant, then re-read the offset at the corrected instant (a DST
 * shift between the two passes converges in one step).
 */
function wallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(timezone, new Date(wallUtc));
  const real1 = wallUtc - off1;
  const off2 = tzOffsetMs(timezone, new Date(real1));
  return new Date(wallUtc - off2);
}

// ─── Schedule resolution ──────────────────────────────────────────────────

/** A day's intervals from the weekly schedule (allDay → 00:00–24:00). */
function weeklyDayIntervals(weekly: WeeklyDay[], weekday: number): Interval[] {
  const entry = weekly.find((w) => w.weekday === weekday);
  if (!entry) return [];
  if (entry.allDay === true) return [{ open: '00:00', close: '24:00' }];
  return entry.intervals ?? [];
}

/** A special day's intervals (closed → []; absent intervals → []). */
function specialDayIntervals(day: SpecialDay | null): Interval[] {
  if (!day) return [];
  if (day.closed) return [];
  return day.intervals ?? [];
}

// ─── computeOpenStatus (pure) ────────────────────────────────────────────

export interface ComputeOpenStatusInput {
  weekly: WeeklyHours;
  specialDays: SpecialDay[];
  timezone: string;
  now: Date;
  soonMinutes?: number;
}

/**
 * Pure "open now" computation (B2.5). Resolves `now` into the business city's
 * wall clock via `Intl.DateTimeFormat`, then checks the incoming tail from the
 * previous day and today's own intervals (special-day overrides take
 * precedence over the weekly schedule). Returns the open/closed state, the
 * soon-ness within `soonMinutes` (default 60), the next change instant, and
 * today's intervals for display.
 *
 * Tail rule (documented in DECISIONS B2.5): a midnight-crossing interval from
 * the previous day continues into today's early hours UNLESS today is a closed
 * special day, which cancels the tail. A special day replaces the whole day's
 * schedule (closed or its own intervals); non-special days use the weekly
 * schedule for that weekday.
 */
export function computeOpenStatus(input: ComputeOpenStatusInput): OpenStatus {
  const { weekly, specialDays, timezone, now } = input;
  const soonMinutes = input.soonMinutes ?? 60;
  const soonMs = soonMinutes * 60_000;

  const today = formatInTz(now, timezone);
  const minutes = today.hour * 60 + today.minute;

  // Yesterday / tomorrow calendar dates, robust across DST: formatting the UTC
  // midnight of the adjacent local calendar day lands inside the same adjacent
  // local day for every IANA offset (±14h).
  const yesterday = formatInTz(
    new Date(Date.UTC(today.year, today.month - 1, today.day - 1)),
    timezone,
  );
  const tomorrow = formatInTz(
    new Date(Date.UTC(today.year, today.month - 1, today.day + 1)),
    timezone,
  );

  const todaySpecial = specialDays.find((d) => d.date === today.dateStr) ?? null;
  const yesterdaySpecial = specialDays.find((d) => d.date === yesterday.dateStr) ?? null;
  const tomorrowSpecial = specialDays.find((d) => d.date === tomorrow.dateStr) ?? null;

  const todayIsClosedSpecial = todaySpecial?.closed === true;

  const todayIntervals = todaySpecial
    ? specialDayIntervals(todaySpecial)
    : weeklyDayIntervals(weekly, today.weekday);
  const yesterdayIntervals = yesterdaySpecial
    ? specialDayIntervals(yesterdaySpecial)
    : weeklyDayIntervals(weekly, yesterday.weekday);

  // Incoming tail = yesterday's midnight-crossing intervals, cancelled when
  // today is a closed special day.
  const incomingTail = todayIsClosedSpecial ? [] : yesterdayIntervals.filter(crossesMidnight);

  // Collect active close instants (UTC) while deciding open/closed.
  const closeInstants: Date[] = [];
  let open = false;

  if (!todayIsClosedSpecial) {
    // Tail: covers [00:00, close) today.
    for (const iv of incomingTail) {
      const closeMin = timeToMinutes(iv.close); // < 1440 (crossing)
      if (minutes < closeMin) {
        open = true;
        closeInstants.push(
          wallToInstant(today.year, today.month, today.day, 0, closeMin, timezone),
        );
      }
    }
    // Today's own intervals.
    for (const iv of todayIntervals) {
      const openMin = timeToMinutes(iv.open);
      const closeMin = iv.close === '24:00' ? DAY_MINUTES : timeToMinutes(iv.close);
      const isAllDay = iv.open === '00:00' && iv.close === '24:00';
      const crossing = closeMin <= openMin; // close < open (close ≠ 24:00 here)
      if (isAllDay) {
        open = true;
        // all-day never closes today → no close instant
      } else if (crossing) {
        if (minutes >= openMin) {
          open = true;
          closeInstants.push(
            wallToInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, closeMin, timezone),
          );
        }
      } else if (minutes >= openMin && minutes < closeMin) {
        open = true;
        // close at closeMin today; 24:00 → tomorrow 00:00.
        if (iv.close === '24:00') {
          closeInstants.push(
            wallToInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timezone),
          );
        } else {
          closeInstants.push(
            wallToInstant(today.year, today.month, today.day, 0, closeMin, timezone),
          );
        }
      }
    }
  }

  const nowMs = now.getTime();
  const futureCloseInstants = closeInstants.filter((d) => d.getTime() > nowMs);
  const soonestClose = futureCloseInstants.length
    ? futureCloseInstants.reduce((a, b) => (a.getTime() < b.getTime() ? a : b))
    : null;

  let state: OpenState;
  let nextChangeAt: string | null;

  if (open) {
    if (soonestClose) {
      const untilCloseMs = soonestClose.getTime() - nowMs;
      state = untilCloseMs <= soonMs ? 'closing_soon' : 'open';
      nextChangeAt = soonestClose.toISOString();
    } else {
      // open via all-day only (no closing today)
      state = 'open';
      nextChangeAt = null;
    }
  } else {
    // Closed: find the next open instant — today's remaining opens first, then
    // today's crossing tail into tomorrow, then tomorrow's own schedule.
    const openInstants: Date[] = [];

    for (const iv of todayIntervals) {
      if (iv.open === '00:00' && iv.close === '24:00') continue; // would be open, not closed
      const openMin = timeToMinutes(iv.open);
      if (openMin > minutes) {
        openInstants.push(wallToInstant(today.year, today.month, today.day, 0, openMin, timezone));
      }
    }
    // A crossing interval on today opens a tail at tomorrow 00:00.
    for (const iv of todayIntervals) {
      if (crossesMidnight(iv)) {
        openInstants.push(
          wallToInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timezone),
        );
      }
    }
    // Tomorrow's own schedule.
    const tomorrowIntervals = tomorrowSpecial
      ? specialDayIntervals(tomorrowSpecial)
      : weeklyDayIntervals(weekly, tomorrow.weekday);
    for (const iv of tomorrowIntervals) {
      if (iv.open === '00:00' && iv.close === '24:00') {
        openInstants.push(
          wallToInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timezone),
        );
      } else {
        const openMin = timeToMinutes(iv.open);
        openInstants.push(
          wallToInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, openMin, timezone),
        );
      }
    }

    const futureOpenInstants = openInstants.filter((d) => d.getTime() > nowMs);
    const soonestOpen = futureOpenInstants.length
      ? futureOpenInstants.reduce((a, b) => (a.getTime() < b.getTime() ? a : b))
      : null;

    if (soonestOpen) {
      const untilOpenMs = soonestOpen.getTime() - nowMs;
      state = untilOpenMs <= soonMs ? 'opening_soon' : 'closed';
      nextChangeAt = soonestOpen.toISOString();
    } else {
      state = 'closed';
      nextChangeAt = null;
    }
  }

  return {
    isOpen: open,
    state,
    nextChangeAt,
    todayIntervals,
  };
}

// ─── HoursService ────────────────────────────────────────────────────────

@Injectable()
export class HoursService {
  constructor(
    @Inject(HOURS_REPOSITORY) private readonly repo: HoursRepositoryLike,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
  ) {}

  async getWeekly(businessId: string): Promise<WeeklyDay[]> {
    return this.repo.findWeekly(businessId);
  }

  /**
   * Replace the weekly schedule atomically. The contract `weeklyHoursSchema`
   * has already validated overlap, weekday uniqueness and the allDay/intervals
   * exclusivity at the controller edge; `24:00` is normalised by the schema.
   * The whole replace runs in one transaction so a failure keeps the old hours.
   */
  async replaceWeekly(businessId: string, weekly: WeeklyHours): Promise<WeeklyDay[]> {
    await this.repo.replaceWeekly(businessId, weekly as WeeklyDay[]);
    return this.repo.findWeekly(businessId);
  }

  async getSpecialDays(businessId: string, from: string, to: string): Promise<SpecialDay[]> {
    return this.repo.findSpecialDays(businessId, from, to);
  }

  async upsertSpecialDay(
    businessId: string,
    date: string,
    body: UpsertSpecialDayBody,
  ): Promise<SpecialDay> {
    return this.repo.upsertSpecialDay(businessId, date, body);
  }

  async deleteSpecialDay(businessId: string, date: string): Promise<void> {
    await this.repo.deleteSpecialDay(businessId, date);
  }

  /**
   * Load the business context for the hours endpoints: existence, owner,
   * status, soft-delete flag and the city's IANA timezone. Throws NotFound
   * (404) when the business does not exist or is soft-deleted.
   */
  async getBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: string;
    timezone: string;
  }> {
    const ctx = await this.repo.findBusinessContext(businessId);
    if (!ctx || ctx.deletedAt) {
      throw new NotFoundException(`Business ${businessId} not found`);
    }
    return { ownerId: ctx.ownerId, status: ctx.status, timezone: ctx.timezone };
  }

  /**
   * Build the GET /hours response: weekly schedule, special days for the next
   * 60 days from `now`, and the computed open-status at `now` in the city tz.
   */
  async getHoursResponse(
    businessId: string,
    timezone: string,
    now: Date = new Date(),
  ): Promise<HoursResponse> {
    const [weekly, specialDays] = await Promise.all([
      this.repo.findWeekly(businessId),
      this.upcomingSpecialDays(businessId, now),
    ]);
    const openStatus = computeOpenStatus({ weekly, specialDays, timezone, now });
    return { weekly, specialDays, openStatus };
  }

  /** Special days from today (local tz) through +60 days, for the GET response. */
  private async upcomingSpecialDays(businessId: string, now: Date): Promise<SpecialDay[]> {
    const today = formatInTz(now, 'Asia/Tehran'); // tz only affects the window start; absolute date is fine
    const from = today.dateStr;
    const toDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 60));
    const to = formatInTz(toDate, 'Asia/Tehran').dateStr;
    return this.repo.findSpecialDays(businessId, from, to);
  }
}
