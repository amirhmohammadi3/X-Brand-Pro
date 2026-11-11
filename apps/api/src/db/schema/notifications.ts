import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * Notification core (B5.3). Three tables:
 *
 * - `notification_events` — the event CATALOG: one row per key from the
 *   contracts' NOTIFICATION_EVENT_KEYS (seeded, admin-editable later). It
 *   stores the DEFAULT channel matrix; a MISSING row falls back to the
 *   code defaults (NOTIFICATION_EVENT_DEFAULTS) — the catalog is an
 *   optimization, never a hard dependency. `is_active = false` silences an
 *   event globally (all channels skipped) without deleting history.
 *
 * - `notification_preferences` — the USER's per-event channel overrides.
 *   Rows are written ON DEMAND (when the user touches a preference); an
 *   absent row means "use the event defaults", so no bulk write at
 *   registration and the effective matrix is one indexed lookup.
 *
 * - `notifications` — the in-app INBOX: one row per delivered in-app
 *   notification. `payload` (jsonb) keeps the RAW interpolation vars —
 *   the title/body are RE-RENDERED per read from the i18n tables
 *   (`notifications.<key>.title/.body`), so a translation fix repairs old
 *   rows without a migration. `read_at IS NULL` is the unread state; the
 *   partial index makes the unread count and mark-all-read O(unread).
 *
 * The inbox FK cascades on user deletion; the catalog/preferences tables
 * cascade too — an anonymized account takes its preferences and inbox
 * with it.
 */
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(false),
    sms: boolean('sms').notNull().default(false),
    push: boolean('push').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One catalog row per event key.
    uniqueIndex('notification_events_key_unq').on(table.key),
  ],
);

export type NotificationEventRow = typeof notificationEvents.$inferSelect;
export type NewNotificationEventRow = typeof notificationEvents.$inferInsert;

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(false),
    sms: boolean('sms').notNull().default(false),
    push: boolean('push').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ONE preference row per (user, event) — the upsert target.
    uniqueIndex('notification_preferences_user_key_unq').on(table.userId, table.key),
  ],
);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRow = typeof notificationPreferences.$inferInsert;

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** The RAW interpolation vars — re-rendered per read via i18n. */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Inbox page: newest first per user (id is the stable tiebreak).
    index('notifications_user_created_idx').on(table.userId, table.createdAt.desc(), table.id),
    // Unread count + mark-all-read — O(unread) via the partial index.
    index('notifications_unread_idx')
      .on(table.userId, table.createdAt.desc())
      .where(sql`${table.readAt} IS NULL`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

/**
 * Web push subscriptions (B5.4). One row per (user, browser) — the
 * `endpoint` (the push service URL, e.g. an FCM endpoint) is UNIQUE:
 * re-subscribing the same browser REPLACES the row (new keys + latest
 * user agent) instead of piling up duplicates, and a subscription that
 * moved to another account simply moves with it. `p256dh`/`auth` are the
 * per-subscription encryption keys the W3C Push API mandates (NOT user
 * secrets in the settings sense — they are useless without the endpoint
 * and are rotated by the browser on every re-subscription). A dead
 * subscription (404/410 from the push service) is deleted at first send —
 * the table self-cleans, no sweep job.
 *
 * The FK cascades on user deletion (anonymization takes subscriptions
 * with it); the (user, created) index serves the "my devices" list.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ONE row per push endpoint — the re-subscribe upsert target.
    uniqueIndex('push_subscriptions_endpoint_unq').on(table.endpoint),
    // The "my devices" list + fan-out per user, newest first.
    index('push_subscriptions_user_idx').on(table.userId, table.createdAt.desc(), table.id),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
