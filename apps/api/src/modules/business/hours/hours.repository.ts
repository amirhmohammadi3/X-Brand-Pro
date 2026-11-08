import { Inject, Injectable, type NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { businessHours, businessSpecialDays } from '../../../db/schema/hours.js';
import { businesses } from '../../../db/schema/business.js';
import { cities } from '../../../db/schema/geo.js';
import {
  type Interval,
  type SpecialDay,
  type UpsertSpecialDayBody,
  type WeeklyDay,
  intervalSchema,
  crossesMidnight as intervalCrossesMidnight,
} from '@app/contracts';

/** DI token for the hours repository (tests bind a fake). */
export const HOURS_REPOSITORY = Symbol('HOURS_REPOSITORY');

/** The narrow fake-able surface consumed by HoursService + B2.5's HTTP layer. */
export interface HoursRepositoryLike {
  findWeekly(businessId: string): Promise<WeeklyDay[]>;
  replaceWeekly(businessId: string, weekly: WeeklyDay[]): Promise<void>;
  findSpecialDays(businessId: string, from: string, to: string): Promise<SpecialDay[]>;
  upsertSpecialDay(
    businessId: string,
    date: string,
    body: UpsertSpecialDayBody,
  ): Promise<SpecialDay>;
  deleteSpecialDay(businessId: string, date: string): Promise<void>;
  findBusinessContext(
    businessId: string,
  ): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
    timezone: string;
  } | null>;
}

/** `HH:mm` → `HH:mm:ss` for the `time` column (`24:00` → `24:00:00`). */
function toDbTime(hhmm: string): string {
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

/** `HH:mm:ss` (drizzle `time` string) → `HH:mm` (`24:00:00` → `24:00`). */
function fromDbTime(db: string): string {
  return db.slice(0, 5);
}

/** Coerce a stored jsonb value into a validated `Interval[]` (empty when null). */
function readIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((iv) => intervalSchema.safeParse(iv))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: Interval }).data);
}

@Injectable()
export class HoursRepository implements HoursRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findWeekly(businessId: string): Promise<WeeklyDay[]> {
    const rows = await this.client.db
      .select()
      .from(businessHours)
      .where(eq(businessHours.businessId, businessId))
      .orderBy(asc(businessHours.weekday), asc(businessHours.sortOrder), asc(businessHours.id));
    const byWeekday = new Map<number, WeeklyDay>();
    for (const row of rows) {
      const weekday = row.weekday;
      if (row.allDay) {
        byWeekday.set(weekday, { weekday, allDay: true });
        continue;
      }
      const entry = byWeekday.get(weekday);
      const interval: Interval = {
        open: fromDbTime(row.openTime),
        close: fromDbTime(row.closeTime),
      };
      if (entry && entry.allDay !== true && entry.intervals) {
        entry.intervals.push(interval);
      } else {
        byWeekday.set(weekday, { weekday, intervals: [interval] });
      }
    }
    return [...byWeekday.values()];
  }

  async replaceWeekly(businessId: string, weekly: WeeklyDay[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(businessHours).where(eq(businessHours.businessId, businessId));
      const inserts: Array<{
        businessId: string;
        weekday: number;
        openTime: string;
        closeTime: string;
        crossesMidnight: boolean;
        allDay: boolean;
        sortOrder: number;
      }> = [];
      for (const day of weekly) {
        if (day.allDay === true) {
          inserts.push({
            businessId,
            weekday: day.weekday,
            openTime: '00:00:00',
            closeTime: '24:00:00',
            crossesMidnight: false,
            allDay: true,
            sortOrder: 0,
          });
        } else if (day.intervals) {
          day.intervals.forEach((iv, index) => {
            inserts.push({
              businessId,
              weekday: day.weekday,
              openTime: toDbTime(iv.open),
              closeTime: toDbTime(iv.close),
              crossesMidnight: intervalCrossesMidnight(iv),
              allDay: false,
              sortOrder: index,
            });
          });
        }
      }
      if (inserts.length > 0) {
        await tx.insert(businessHours).values(inserts);
      }
    });
  }

  async findSpecialDays(businessId: string, from: string, to: string): Promise<SpecialDay[]> {
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

  async upsertSpecialDay(
    businessId: string,
    date: string,
    body: UpsertSpecialDayBody,
  ): Promise<SpecialDay> {
    const intervals = body.closed ? null : (body.intervals ?? []);
    const inserted = await this.client.db
      .insert(businessSpecialDays)
      .values({
        businessId,
        date,
        closed: body.closed,
        intervals,
        note: body.note ?? null,
      })
      .onConflictDoUpdate({
        target: [businessSpecialDays.businessId, businessSpecialDays.date],
        set: {
          closed: body.closed,
          intervals,
          note: body.note ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('special day upsert returned no row');
    return {
      date: row.date,
      closed: row.closed,
      intervals: row.intervals ? readIntervals(row.intervals) : undefined,
      note: row.note,
    };
  }

  async deleteSpecialDay(businessId: string, date: string): Promise<void> {
    await this.client.db
      .delete(businessSpecialDays)
      .where(
        and(eq(businessSpecialDays.businessId, businessId), eq(businessSpecialDays.date, date)),
      );
  }

  async findBusinessContext(
    businessId: string,
  ): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
    timezone: string;
  } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
        timezone: cities.timezone,
      })
      .from(businesses)
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ownerId: row.ownerId,
      status: row.status,
      deletedAt: row.deletedAt,
      timezone: row.timezone,
    };
  }
}

/** Re-exported so the service can throw the same NotFound shape as the catalog modules. */
export type { NotFoundException };
