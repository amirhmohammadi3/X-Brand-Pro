import {
  bigint,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';

/**
 * Analytics domain (B7.1/B7.2). TWO tables:

 * - `analytics_events` — the RAW event rows, flushed from the Redis buffer
 *   (B7.1) by the maintenance job in batches. One row per event, NO identity:
 *   no user id, no ip — the analytics promise is aggregate-only («آمار کلی
 *   بدون هویت»); dedup happens upstream in Redis on a salted hash, never
 *   stored. The (business_id, date) columns back the rollup scan; rows are
 *   pruned by the B7.2 job past ANALYTICS_RAW_RETENTION_DAYS.

 * - `analytics_daily` — the daily rollup (B7.2): one row per
 *   (business, date, event_type) with the summed count. The stats API reads
 *   THIS table only (time series + funnel), never the raw rows — fast,
 *   indexed, and small. Unique per (business, date, type) so the upsert is
 *   idempotent and re-runs are safe.
 */

/** The event vocabulary (B7.1): what a business page can measure. */
export const analyticsEventTypeEnum = pgEnum('analytics_event_type', [
  'business_view',
  'call_click',
  'direction_click',
  'share_click',
  'impression',
]);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    eventType: analyticsEventTypeEnum('event_type').notNull(),
    /** Business-local calendar date (rollup grouping key). */
    date: date('date').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Rollup scan (B7.2 job): events of one business-day by type.
    index('analytics_events_rollup_idx').on(table.businessId, table.date, table.eventType),
    // Retention prune (B7.2): oldest first.
    index('analytics_events_date_idx').on(table.date),
  ],
);

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEventRow = typeof analyticsEvents.$inferInsert;

export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    eventType: analyticsEventTypeEnum('event_type').notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One rollup row per business-day-type — the stats API's only table.
    uniqueIndex('analytics_daily_bucket_unq').on(table.businessId, table.date, table.eventType),
    // Time-series scan: one business across days for one type.
    index('analytics_daily_series_idx').on(table.businessId, table.eventType, table.date),
    check('analytics_daily_count_nonneg', sql`${table.count} >= 0`),
  ],
);

export type AnalyticsDailyRow = typeof analyticsDaily.$inferSelect;
export type NewAnalyticsDailyRow = typeof analyticsDaily.$inferInsert;
