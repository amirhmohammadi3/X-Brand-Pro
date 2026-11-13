import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
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
import { users } from './users.js';

/**
 * Booking domain (B6.1). Three tables:

 * - `booking_services` — the bookable offerings of a business («میز
 *   دوتنفره», «پکیج پاکسازی پوست»). ONE row carries every slot rule the
 *   B6.2 availability engine needs: `duration_minutes` (slot length),
 *   `slot_step_minutes` (grid the engine snaps starts to), `capacity`
 *   (concurrent reservations per slot — TABLES, not seats: a booking
 *   occupies ONE unit regardless of `party_size`; party size is only
 *   bounds-checked against min/max, a documented v1 decision), plus the
 *   policy numbers — `min_lead_minutes` (earliest bookable notice),
 *   `cancel_window_minutes` (B6.3 cancellation deadline),
 *   `max_advance_days` (booking horizon). `is_active = false` hides a
 *   service from the public flow without deleting its bookings (the FK
 *   must keep history).

 * - `booking_closed_days` — full-day booking closures (روزهای تعطیل),
 *   DISTINCT from `business_special_days` (B2.5): the owner may keep the
 *   café open but stop taking reservations for a private event, so booking
 *   closures need their own calendar. Unique per (business, date).

 * - `bookings` — the reservation rows. `date` + `start_time`/`end_time`
 *   are business-LOCAL wall clock (Asia/Tehran); v1 slots never cross
 *   midnight (`bookings_end_after_start` check, `24:00` allowed as
 *   end-of-day) — crossing slots are a future extension (the schema keeps
 *   date/time independent, so only the check would change). Status cycle
 *   (B6.3 owns the transitions): pending → confirmed | rejected |
 *   cancelled, confirmed → completed | no_show | cancelled; the last four
 *   are terminal. Only pending + confirmed consume capacity. `code` is the
 *   short human reference (owner lookup / phone confirmations), unique per
 *   business.

 * Every FK cascades: deleting a business/user/service removes its booking
 * rows with it.
 */

/** Booking lifecycle (B6.3). `pending/confirmed` hold capacity; the rest are terminal. */
export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'no_show',
  'completed',
]);

/** Who triggered a cancellation/rejection — user, business owner, or system policy. */
export const bookingCancelActorEnum = pgEnum('booking_cancel_actor', [
  'user',
  'business',
  'system',
]);

export const bookingServices = pgTable(
  'booking_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Slot length in minutes (the reserved span). */
    durationMinutes: integer('duration_minutes').notNull(),
    /** Grid step the engine snaps slot starts to (5..120). */
    slotStepMinutes: integer('slot_step_minutes').notNull().default(30),
    /** Concurrent reservations per slot (tables, not seats — v1). */
    capacity: integer('capacity').notNull().default(1),
    minPartySize: integer('min_party_size').notNull().default(1),
    maxPartySize: integer('max_party_size').notNull().default(10),
    /** Minimum notice: a slot is bookable when now + lead <= slot start. */
    minLeadMinutes: integer('min_lead_minutes').notNull().default(60),
    /** Cancellation deadline (B6.3): free cancel until start − window. */
    cancelWindowMinutes: integer('cancel_window_minutes').notNull().default(120),
    /** Booking horizon: engine serves dates within today + N days. */
    maxAdvanceDays: integer('max_advance_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Public flow reads the active offerings of a business, ordered.
    index('booking_services_biz_active_idx').on(
      table.businessId,
      table.isActive,
      table.sortOrder,
      table.id,
    ),
    // Owner calendar joins bookings → service (name per row).
    index('booking_services_biz_idx').on(table.businessId, table.createdAt.desc(), table.id),
    check('booking_services_name_len', sql`char_length(${table.name}) BETWEEN 1 AND 120`),
    check(
      'booking_services_description_len',
      sql`${table.description} IS NULL OR char_length(${table.description}) BETWEEN 1 AND 500`,
    ),
    check('booking_services_duration_range', sql`${table.durationMinutes} BETWEEN 15 AND 720`),
    check('booking_services_slot_step_range', sql`${table.slotStepMinutes} BETWEEN 5 AND 120`),
    check('booking_services_capacity_range', sql`${table.capacity} BETWEEN 1 AND 200`),
    check('booking_services_party_min_range', sql`${table.minPartySize} BETWEEN 1 AND 50`),
    check('booking_services_party_max_range', sql`${table.maxPartySize} BETWEEN 1 AND 50`),
    check('booking_services_party_order', sql`${table.minPartySize} <= ${table.maxPartySize}`),
    check('booking_services_lead_range', sql`${table.minLeadMinutes} BETWEEN 0 AND 10080`),
    check(
      'booking_services_cancel_window_range',
      sql`${table.cancelWindowMinutes} BETWEEN 0 AND 10080`,
    ),
    check('booking_services_advance_range', sql`${table.maxAdvanceDays} BETWEEN 1 AND 365`),
  ],
);

export type BookingServiceRow = typeof bookingServices.$inferSelect;
export type NewBookingServiceRow = typeof bookingServices.$inferInsert;

export const bookingClosedDays = pgTable(
  'booking_closed_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One closure row per business per date (upsert semantics in the service).
    uniqueIndex('booking_closed_days_biz_date_unq').on(table.businessId, table.date),
    check(
      'booking_closed_days_note_len',
      sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND 200`,
    ),
  ],
);

export type BookingClosedDayRow = typeof bookingClosedDays.$inferSelect;
export type NewBookingClosedDayRow = typeof bookingClosedDays.$inferInsert;

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => bookingServices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Business-local calendar date (Asia/Tehran), `YYYY-MM-DD`. */
    date: date('date').notNull(),
    /** Local wall-clock start; the engine generates `HH:mm:ss` on the slot grid. */
    startTime: time('start_time', { precision: 0 }).notNull(),
    /** start + duration (≤ 24:00 — v1 slots never cross midnight). */
    endTime: time('end_time', { precision: 0 }).notNull(),
    partySize: integer('party_size').notNull(),
    status: bookingStatusEnum('status').notNull().default('pending'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    note: text('note'),
    /** Short human reference, unique per business (owner lookup). */
    code: text('code').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    noShowAt: timestamp('no_show_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelActor: bookingCancelActorEnum('cancel_actor'),
    cancelReason: text('cancel_reason'),
    /** Set when the B6.3 reminder job fires for this booking. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Availability engine scan: count active rows per slot (B6.2).
    index('bookings_slot_scan_idx').on(table.serviceId, table.date, table.startTime),
    // «رزروهای من» (F6.2): newest first per user.
    index('bookings_user_idx').on(table.userId, table.createdAt.desc(), table.id),
    // Owner calendar (F7.5): the day's bookings by status.
    index('bookings_biz_date_idx').on(table.businessId, table.date, table.status),
    // ICS feed + owner list scan by start (B6.4).
    index('bookings_biz_start_idx').on(table.businessId, table.date, table.startTime, table.id),
    // Short reference is unique within the business.
    uniqueIndex('bookings_biz_code_unq').on(table.businessId, table.code),
    check('bookings_party_size_min', sql`${table.partySize} >= 1`),
    // v1: no midnight-crossing slots (see header).
    check('bookings_end_after_start', sql`${table.endTime} > ${table.startTime}`),
    check(
      'bookings_note_len',
      sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND 500`,
    ),
    check(
      'bookings_contact_name_len',
      sql`${table.contactName} IS NULL OR char_length(${table.contactName}) BETWEEN 1 AND 80`,
    ),
    check(
      'bookings_contact_phone_len',
      sql`${table.contactPhone} IS NULL OR char_length(${table.contactPhone}) BETWEEN 4 AND 20`,
    ),
    check(
      'bookings_cancel_reason_len',
      sql`${table.cancelReason} IS NULL OR char_length(${table.cancelReason}) BETWEEN 1 AND 300`,
    ),
    check('bookings_code_format', sql`${table.code} ~ '^[A-Z0-9]{6,10}$'`),
  ],
);

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;
