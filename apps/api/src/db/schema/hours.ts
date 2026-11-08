import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';

/**
 * Weekly opening hours for a business (B2.5). One row per interval per
 * weekday. `all_day` rows are the `{ weekday, allDay: true }` shortcut stored
 * as a single row with `open_time = 00:00`, `close_time = 24:00`. For a normal
 * interval, `crosses_midnight` records whether `close < open` (the interval
 * spills into the next day's early hours); `close = 24:00` is end-of-day and
 * does NOT cross midnight.
 *
 * `time` columns accept `24:00:00` (PostgreSQL treats it as midnight at the
 * end of the day). The repository maps `HH:mm` ↔ `HH:mm:ss` for storage.
 */
export const businessHours = pgTable(
  'business_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(),
    openTime: time('open_time', { precision: 0 }).notNull(),
    closeTime: time('close_time', { precision: 0 }).notNull(),
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    allDay: boolean('all_day').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('business_hours_biz_weekday_idx').on(table.businessId, table.weekday),
    check('business_hours_weekday_range', sql`${table.weekday} between 1 and 7`),
  ],
);

export type BusinessHourRow = typeof businessHours.$inferSelect;
export type NewBusinessHourRow = typeof businessHours.$inferInsert;

/**
 * Per-date overrides of the weekly schedule (B2.5). `closed = true` cancels
 * the day (and cancels the previous day's midnight-crossing tail — see
 * `computeOpenStatus`). Otherwise `intervals` (a JSONB array of `{ open, close }`)
 * replaces the weekly schedule for that date. `unique (business_id, date)`
 * guarantees one override per business per date.
 */
export const businessSpecialDays = pgTable(
  'business_special_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    closed: boolean('closed').notNull(),
    intervals: jsonb('intervals'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('business_special_days_biz_date_unq').on(table.businessId, table.date),
    index('business_special_days_biz_date_idx').on(table.businessId, table.date),
  ],
);

export type BusinessSpecialDayRow = typeof businessSpecialDays.$inferSelect;
export type NewBusinessSpecialDayRow = typeof businessSpecialDays.$inferInsert;
