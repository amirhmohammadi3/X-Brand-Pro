import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { cities } from '../../db/schema/geo.js';
import {
  bookingClosedDays,
  bookingServices,
  bookings,
  type BookingRow,
} from '../../db/schema/bookings.js';
import { businessHours, businessSpecialDays } from '../../db/schema/hours.js';
import {
  BOOKING_ACTIVE_STATUSES,
  type Interval,
  type SpecialDay,
  type WeeklyDay,
  intervalSchema,
} from '@app/contracts';

/** DI token for the bookings repository (tests bind a fake). */
export const BOOKINGS_REPOSITORY = Symbol('BOOKINGS_REPOSITORY');

/** The service + business/tz context every engine decision starts from. */
export interface BookingServiceContext {
  service: {
    id: string;
    businessId: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    slotStepMinutes: number;
    capacity: number;
    minPartySize: number;
    maxPartySize: number;
    minLeadMinutes: number;
    cancelWindowMinutes: number;
    maxAdvanceDays: number;
    isActive: boolean;
    sortOrder: number;
  };
  business: {
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
    timezone: string;
    name: string;
    slug: string;
  };
}

/** A booking row joined with display names + the fields the lifecycle needs. */
export interface BookingDetailRow extends BookingRow {
  serviceName: string;
  businessName: string;
  businessSlug: string;
  businessOwnerId: string | null;
  /** Business lifecycle status (the canManageBusiness gate). */
  businessStatus: string;
  /** Business city timezone — wall-clock → instant conversions. */
  timezone: string;
  /** The service's cancellation policy (B6.3 user-cancel window). */
  cancelWindowMinutes: number;
}

/** A page of detail rows. */
export interface BookingPage {
  rows: BookingDetailRow[];
  total: number;
}

/** The outcome of the conflict-free insert (B6.2). */
export type CreateBookingOutcome =
  | { ok: true; row: BookingRow }
  | { ok: false; reason: 'slot_full' | 'code_conflict' };

/** Scope filter for GET /bookings/me (see contracts). */
export type MyBookingsScope = 'all' | 'upcoming' | 'past';

/**
 * The narrow fake-able surface consumed by BookingsService. Uniqueness
 * races (`bookings_biz_code_unq`) and the capacity race are resolved INSIDE
 * the transaction here and surfaced as the `CreateBookingOutcome` union, so
 * the service answers clean 409s without importing pg error internals.
 */
export interface BookingsRepositoryLike {
  /** The service row + business lifecycle + city timezone (one join). */
  findServiceContext(serviceId: string): Promise<BookingServiceContext | null>;
  /** The booking closed day for (business, date), null when open. */
  findClosedDay(businessId: string, date: string): Promise<{ note: string | null } | null>;
  /** Weekly schedule (same shape the hours module serves). */
  findWeekly(businessId: string): Promise<WeeklyDay[]>;
  /** Special-day overrides for [from, to] (the engine asks for D-1..D). */
  findSpecialDaysInRange(businessId: string, from: string, to: string): Promise<SpecialDay[]>;
  /** Active (pending+confirmed) counts per slot start for one service-day. */
  countActiveByStart(serviceId: string, date: string): Promise<Record<string, number>>;
  /** The user's open bookings at ONE business (anti-spam cap). */
  countUserActiveForBusiness(userId: string, businessId: string): Promise<number>;
  /**
   * The conflict-free insert: advisory lock on (service, date) → recount the
   * slot against `capacity` → insert. `slot_full` when the recount finds the
   * slot gone, `code_conflict` on the (business, code) unique race (the
   * service retries with a fresh code).
   */
  createBookingTx(input: {
    businessId: string;
    serviceId: string;
    userId: string;
    date: string;
    startTime: string;
    endTime: string;
    partySize: number;
    contactName: string | null;
    contactPhone: string | null;
    note: string | null;
    code: string;
    capacity: number;
  }): Promise<CreateBookingOutcome>;
  /** One booking + display joins, by id (404-never-leak checks upstream). */
  findBookingDetail(id: string): Promise<BookingDetailRow | null>;
  /**
   * Guarded transition (B6.3): UPDATE ... WHERE id AND status IN (from) —
   * returns the DETAIL row when the guard matched, null on a stale read
   * (another actor moved the status first → the service answers 409).
   */
  transitionStatus(
    id: string,
    fromStatuses: string[],
    patch: {
      status: string;
      confirmedAt?: Date;
      rejectedAt?: Date;
      completedAt?: Date;
      noShowAt?: Date;
      cancelledAt?: Date;
      cancelActor?: 'user' | 'business' | 'system' | null;
      cancelReason?: string | null;
    },
  ): Promise<BookingDetailRow | null>;
  /**
   * Reminder scan (B6.3): active bookings on today/tomorrow (Tehran anchor)
   * with no reminder yet, joined with the business city's timezone — the
   * due filter (start within the lead window) is computed in the service.
   */
  findReminderCandidates(today: string, tomorrow: string): Promise<ReminderCandidate[]>;
  /** Stamp the reminder as sent (idempotent — the scan filters on NULL). */
  stampReminderSent(ids: string[]): Promise<void>;
  /** Page over the user's bookings, newest first, optional status + scope. */
  listUserBookings(
    userId: string,
    opts: {
      page: number;
      pageSize: number;
      status?: string;
      scope: MyBookingsScope;
      today: string;
      nowTime: string;
    },
  ): Promise<BookingPage>;
}

/** Coerce a stored jsonb value into a validated `Interval[]` (empty when null). */
function readIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((iv) => intervalSchema.safeParse(iv))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: Interval }).data);
}

/** A reminder-scan candidate (B6.3) — the service computes the due filter. */
export interface ReminderCandidate {
  id: string;
  userId: string;
  businessId: string;
  date: string;
  startTime: string;
  timezone: string;
}

const ACTIVE = [...BOOKING_ACTIVE_STATUSES] as ['pending', 'confirmed'];

@Injectable()
export class BookingsRepository implements BookingsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findServiceContext(serviceId: string): Promise<BookingServiceContext | null> {
    const rows = await this.client.db
      .select({
        service: {
          id: bookingServices.id,
          businessId: bookingServices.businessId,
          name: bookingServices.name,
          description: bookingServices.description,
          durationMinutes: bookingServices.durationMinutes,
          slotStepMinutes: bookingServices.slotStepMinutes,
          capacity: bookingServices.capacity,
          minPartySize: bookingServices.minPartySize,
          maxPartySize: bookingServices.maxPartySize,
          minLeadMinutes: bookingServices.minLeadMinutes,
          cancelWindowMinutes: bookingServices.cancelWindowMinutes,
          maxAdvanceDays: bookingServices.maxAdvanceDays,
          isActive: bookingServices.isActive,
          sortOrder: bookingServices.sortOrder,
        },
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
        timezone: cities.timezone,
        name: businesses.name,
        slug: businesses.slug,
      })
      .from(bookingServices)
      .innerJoin(businesses, eq(businesses.id, bookingServices.businessId))
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(eq(bookingServices.id, serviceId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      service: row.service,
      business: {
        ownerId: row.ownerId,
        status: row.status,
        deletedAt: row.deletedAt,
        timezone: row.timezone,
        name: row.name,
        slug: row.slug,
      },
    };
  }

  async findClosedDay(businessId: string, date: string): Promise<{ note: string | null } | null> {
    const rows = await this.client.db
      .select({ note: bookingClosedDays.note })
      .from(bookingClosedDays)
      .where(and(eq(bookingClosedDays.businessId, businessId), eq(bookingClosedDays.date, date)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findWeekly(businessId: string): Promise<WeeklyDay[]> {
    const rows = await this.client.db
      .select()
      .from(businessHours)
      .where(eq(businessHours.businessId, businessId))
      .orderBy(asc(businessHours.weekday), asc(businessHours.sortOrder), asc(businessHours.id));
    const byWeekday = new Map<number, WeeklyDay>();
    for (const row of rows) {
      if (row.allDay) {
        byWeekday.set(row.weekday, { weekday: row.weekday, allDay: true });
        continue;
      }
      const interval: Interval = {
        open: row.openTime.slice(0, 5),
        close: row.closeTime.slice(0, 5),
      };
      const entry = byWeekday.get(row.weekday);
      if (entry && entry.allDay !== true && entry.intervals) {
        entry.intervals.push(interval);
      } else {
        byWeekday.set(row.weekday, { weekday: row.weekday, intervals: [interval] });
      }
    }
    return [...byWeekday.values()];
  }

  async findSpecialDaysInRange(
    businessId: string,
    from: string,
    to: string,
  ): Promise<SpecialDay[]> {
    const rows = await this.client.db
      .select()
      .from(businessSpecialDays)
      .where(
        and(
          eq(businessSpecialDays.businessId, businessId),
          gte(businessSpecialDays.date, from),
          lte(businessSpecialDays.date, to),
        ),
      )
      .orderBy(asc(businessSpecialDays.date));
    return rows.map((row) => ({
      date: row.date,
      closed: row.closed,
      intervals: row.intervals ? readIntervals(row.intervals) : undefined,
      note: row.note,
    }));
  }

  async countActiveByStart(serviceId: string, date: string): Promise<Record<string, number>> {
    const rows = await this.client.db
      .select({ startTime: bookings.startTime, cnt: count(bookings.id) })
      .from(bookings)
      .where(
        and(
          eq(bookings.serviceId, serviceId),
          eq(bookings.date, date),
          inArray(bookings.status, ACTIVE),
        ),
      )
      .groupBy(bookings.startTime);
    const map: Record<string, number> = {};
    for (const row of rows) map[row.startTime] = Number(row.cnt);
    return map;
  }

  async countUserActiveForBusiness(userId: string, businessId: string): Promise<number> {
    const rows = await this.client.db
      .select({ cnt: count(bookings.id) })
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, userId),
          eq(bookings.businessId, businessId),
          inArray(bookings.status, ACTIVE),
        ),
      );
    return Number(rows[0]?.cnt ?? 0);
  }

  async createBookingTx(input: {
    businessId: string;
    serviceId: string;
    userId: string;
    date: string;
    startTime: string;
    endTime: string;
    partySize: number;
    contactName: string | null;
    contactPhone: string | null;
    note: string | null;
    code: string;
    capacity: number;
  }): Promise<CreateBookingOutcome> {
    return this.client.db.transaction(async (tx) => {
      // Serialize every engine decision for (service, date): concurrent
      // creators line up here, then the recount + insert run on a stable
      // snapshot inside the same transaction (B6.2's «تراکنش و قفل»).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.serviceId}), hashtext(${input.date}))`,
      );
      const active = await tx
        .select({ cnt: count(bookings.id) })
        .from(bookings)
        .where(
          and(
            eq(bookings.serviceId, input.serviceId),
            eq(bookings.date, input.date),
            eq(bookings.startTime, input.startTime),
            inArray(bookings.status, ACTIVE),
          ),
        );
      if (Number(active[0]?.cnt ?? 0) >= input.capacity) {
        return { ok: false as const, reason: 'slot_full' as const };
      }
      try {
        const inserted = await tx
          .insert(bookings)
          .values({
            businessId: input.businessId,
            serviceId: input.serviceId,
            userId: input.userId,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
            partySize: input.partySize,
            status: 'pending',
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            note: input.note,
            code: input.code,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('booking insert returned no row');
        return { ok: true as const, row };
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return { ok: false as const, reason: 'code_conflict' as const };
        }
        throw error;
      }
    });
  }

  async findBookingDetail(id: string): Promise<BookingDetailRow | null> {
    const rows = await this.client.db
      .select({
        row: bookings,
        serviceName: bookingServices.name,
        businessName: businesses.name,
        businessSlug: businesses.slug,
        businessOwnerId: businesses.ownerId,
        businessStatus: businesses.status,
        timezone: cities.timezone,
        cancelWindowMinutes: bookingServices.cancelWindowMinutes,
      })
      .from(bookings)
      .innerJoin(bookingServices, eq(bookingServices.id, bookings.serviceId))
      .innerJoin(businesses, eq(businesses.id, bookings.businessId))
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(eq(bookings.id, id))
      .limit(1);
    const found = rows[0];
    if (!found) return null;
    return {
      ...found.row,
      serviceName: found.serviceName,
      businessName: found.businessName,
      businessSlug: found.businessSlug,
      businessOwnerId: found.businessOwnerId,
      businessStatus: found.businessStatus,
      timezone: found.timezone,
      cancelWindowMinutes: found.cancelWindowMinutes,
    };
  }

  async transitionStatus(
    id: string,
    fromStatuses: string[],
    patch: {
      status: BookingRow['status'];
      confirmedAt?: Date;
      rejectedAt?: Date;
      completedAt?: Date;
      noShowAt?: Date;
      cancelledAt?: Date;
      cancelActor?: 'user' | 'business' | 'system' | null;
      cancelReason?: string | null;
    },
  ): Promise<BookingDetailRow | null> {
    const updated = await this.client.db
      .update(bookings)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(bookings.id, id), inArray(bookings.status, fromStatuses as BookingRow['status'][])),
      )
      .returning();
    const row = updated[0];
    if (!row) return null; // guard missed — another actor moved first
    return this.findBookingDetail(row.id);
  }

  async findReminderCandidates(today: string, tomorrow: string): Promise<ReminderCandidate[]> {
    const rows = await this.client.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        businessId: bookings.businessId,
        date: bookings.date,
        startTime: bookings.startTime,
        timezone: cities.timezone,
      })
      .from(bookings)
      .innerJoin(businesses, eq(businesses.id, bookings.businessId))
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(
        and(
          inArray(bookings.date, [today, tomorrow]),
          inArray(bookings.status, ACTIVE),
          isNull(bookings.reminderSentAt),
        ),
      );
    return rows;
  }

  async stampReminderSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.db
      .update(bookings)
      .set({ reminderSentAt: new Date(), updatedAt: new Date() })
      .where(inArray(bookings.id, ids));
  }

  async listUserBookings(
    userId: string,
    opts: {
      page: number;
      pageSize: number;
      status?: string;
      scope: MyBookingsScope;
      today: string;
      nowTime: string;
    },
  ): Promise<BookingPage> {
    // Upcoming = still active AND not yet started (business-local wall clock);
    // past = the exact complement, so `all` partitions cleanly.
    const upcomingSql: SQL = and(
      inArray(bookings.status, ACTIVE),
      or(
        gt(bookings.date, opts.today),
        and(eq(bookings.date, opts.today), gte(bookings.startTime, opts.nowTime)),
      ),
    ) as SQL;

    const filters: SQL[] = [eq(bookings.userId, userId) as SQL];
    if (opts.status) {
      filters.push(eq(bookings.status, opts.status as BookingRow['status']) as SQL);
    }
    if (opts.scope === 'upcoming') filters.push(upcomingSql);
    if (opts.scope === 'past') filters.push(not(upcomingSql));

    const where = and(...filters);
    const offset = (opts.page - 1) * opts.pageSize;

    const rows = await this.client.db
      .select({
        row: bookings,
        serviceName: bookingServices.name,
        businessName: businesses.name,
        businessSlug: businesses.slug,
        businessOwnerId: businesses.ownerId,
        businessStatus: businesses.status,
        timezone: cities.timezone,
        cancelWindowMinutes: bookingServices.cancelWindowMinutes,
      })
      .from(bookings)
      .innerJoin(bookingServices, eq(bookingServices.id, bookings.serviceId))
      .innerJoin(businesses, eq(businesses.id, bookings.businessId))
      .where(where)
      .orderBy(desc(bookings.date), desc(bookings.startTime), desc(bookings.id))
      .limit(opts.pageSize)
      .offset(offset);

    const totalRows = await this.client.db
      .select({ cnt: count(bookings.id) })
      .from(bookings)
      .where(where);

    return {
      rows: rows.map((found) => ({
        ...found.row,
        serviceName: found.serviceName,
        businessName: found.businessName,
        businessSlug: found.businessSlug,
        businessOwnerId: found.businessOwnerId,
        businessStatus: found.businessStatus,
        timezone: found.timezone,
        cancelWindowMinutes: found.cancelWindowMinutes,
      })),
      total: Number(totalRows[0]?.cnt ?? 0),
    };
  }
}
