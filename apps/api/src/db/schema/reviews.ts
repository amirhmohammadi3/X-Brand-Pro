import {
  boolean,
  check,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { mediaFiles } from './media.js';
import { users } from './users.js';

/**
 * Reviews (B4.1). A user's rating (1..5) + text (+ optional photo) of an
 * ACTIVE business. One review per user per business — the partial unique
 * index `reviews_one_per_business` (WHERE deleted... no soft delete here:
 * reviews are hard-deleted) is a FULL unique on (business_id, user_id);
 * re-reviewing means editing the existing row (409 otherwise).
 *
 * Lifecycle: rows are created `approved`; `pending`/`rejected` are reserved
 * for the moderation prompts (B4.4 queue, B4.5 spam filter). Only `approved`
 * rows count toward the business aggregate — `businesses.avg_rating`/
 * `review_count` are recomputed asynchronously by the `reviews` queue's
 * `recompute-rating` job (B4.1), never inline in the request path.
 *
 * `photo_media_id` FK is ON DELETE SET NULL: the media module hard-deletes
 * rows during cleanup; the review (its text is the content) survives with the
 * photo reference nulled — the same scheme as `business_claims.document_media_id`.
 *
 * B4.6 verification columns: a VALIDATED check-in is one `checkin_at` +
 * `checkin_lat` + `checkin_lng` triple (all three or none — the
 * `reviews_checkin_tri_state` CHECK keeps the row domain closed); the badge
 * is DERIVED per read (`checkin_at IS NOT NULL OR receipt_media_id IS NOT
 * NULL`) instead of a stored `checkin_verified` boolean — a stored flag can
 * drift from the proof columns, a derived value cannot (the B4.2
 * derived-counts decision applied to trust). The raw coordinates are
 * personal data: they serve verification/audit only and are never mapped
 * into the public DTO.
 */
export const reviewStatusEnum = pgEnum('review_status', ['approved', 'pending', 'rejected']);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    body: text('body').notNull(),
    status: reviewStatusEnum('status').notNull().default('approved'),
    photoMediaId: uuid('photo_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    /** B4.6 — receipt proof (kind `verification_receipt`); SET NULL like the photo. */
    receiptMediaId: uuid('receipt_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    /** B4.6 — the validated visit time (always stored with the coords below). */
    checkinAt: timestamp('checkin_at', { withTimezone: true }),
    /** B4.6 — where the visit happened (WGS84; verified ≤ CHECKIN_RADIUS_M). */
    checkinLat: doublePrecision('checkin_lat'),
    checkinLng: doublePrecision('checkin_lng'),
    /**
     * B4.7 — «اولین نظر»: stamped at create when the author had no prior
     * review row (any status). Historical: a deleted first review is NOT
     * re-awarded to a later one (the badge marks the event, not the rank).
     */
    isFirst: boolean('is_first').notNull().default(false),
    /** Stamped by the service when the author edits the review after creation. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** B4.4 — the moderator's note when the queue flips the status. */
    moderatorNote: text('moderator_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One review per user per business — re-reviewing means editing.
    uniqueIndex('reviews_one_per_business').on(table.businessId, table.userId),
    // Business page list: approved reviews, newest first (id is the stable tiebreak).
    index('reviews_business_list_idx').on(
      table.businessId,
      table.status,
      table.createdAt.desc(),
      table.id,
    ),
    // "My reviews" (GET /reviews/me): newest first per user.
    index('reviews_user_idx').on(table.userId, table.createdAt.desc()),
    // Moderation queue (B4.4): oldest-pending-first triage.
    index('reviews_status_created_idx').on(table.status, table.createdAt.asc()),
    check('reviews_rating_range', sql`${table.rating} BETWEEN 1 AND 5`),
    check('reviews_body_len', sql`char_length(${table.body}) BETWEEN 10 AND 2000`),
    check(
      'reviews_moderator_note_len',
      sql`${table.moderatorNote} IS NULL OR char_length(${table.moderatorNote}) BETWEEN 2 AND 1000`,
    ),
    // B4.6 — the check-in triple is all-or-nothing (time + both coords), and
    // the coords stay inside the WGS84 domains (a zod backstop at the DB).
    check(
      'reviews_checkin_tri_state',
      sql`(${table.checkinAt} IS NULL) = (${table.checkinLat} IS NULL) AND (${table.checkinLat} IS NULL) = (${table.checkinLng} IS NULL)`,
    ),
    check(
      'reviews_checkin_lat_range',
      sql`${table.checkinLat} IS NULL OR (${table.checkinLat} BETWEEN -90 AND 90)`,
    ),
    check(
      'reviews_checkin_lng_range',
      sql`${table.checkinLng} IS NULL OR (${table.checkinLng} BETWEEN -180 AND 180)`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type NewReviewRow = typeof reviews.$inferInsert;

/**
 * Review votes (B4.2). ONE vote per user per review — the unique index
 * `review_votes_one_per_user` makes the write an UPSERT: re-voting the same
 * value is an idempotent no-op, the opposite value switches the vote and
 * DELETE withdraws it. `value` is 1 (helpful) or -1 (unhelpful) — a CHECK
 * keeps the domain closed. Counts are NEVER denormalised onto `reviews`;
 * every read derives them from this table (correlated count subselects off
 * the unique index), so a takedown (B4.4) or a switch can never drift the
 * displayed score. Both FKs cascade: a deleted review or user takes the
 * votes with it (GDPR-style personal data).
 */
export const reviewVotes = pgTable(
  'review_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: smallint('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One vote per user per review — the upsert target (review_id first so
    // the per-review counts also scan this index).
    uniqueIndex('review_votes_one_per_user').on(table.reviewId, table.userId),
    // The voter's own votes (B4.8 Q&A and future "my votes" views), newest first.
    index('review_votes_user_idx').on(table.userId, table.createdAt.desc()),
    check('review_votes_value', sql`${table.value} IN (1, -1)`),
  ],
);

export type ReviewVoteRow = typeof reviewVotes.$inferSelect;
export type NewReviewVoteRow = typeof reviewVotes.$inferInsert;

/**
 * Owner replies (B4.3). ONE reply per review — the unique index
 * `review_replies_one_per_review` turns a second PUT into an in-place EDIT
 * (body + edited_at stamped), never a thread. Only the business owner
 * (owner_id match, owner-editable status) or a `businesses.manage` holder
 * may WRITE; `reviews.manage` moderators and the reply's author may DELETE
 * (takedown / self-removal) — the authorization lives in the service, the
 * schema only guards the data domain. FKs cascade: a deleted review (author
 * delete or moderation takedown) or user takes the reply with it — an
 * unowned reply must never outlive the review it answers.
 */
export const reviewReplies = pgTable(
  'review_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Stamped by the service when an allowed caller edits the reply. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One reply per review — the upsert target AND the review-list join key
    // (every business-page read LEFT JOINs this index).
    uniqueIndex('review_replies_one_per_review').on(table.reviewId),
    // The replier's own replies (moderation takedowns, "my replies" views).
    index('review_replies_user_idx').on(table.userId, table.createdAt.desc()),
    check('review_replies_body_len', sql`char_length(${table.body}) BETWEEN 2 AND 1000`),
  ],
);

export type ReviewReplyRow = typeof reviewReplies.$inferSelect;
export type NewReviewReplyRow = typeof reviewReplies.$inferInsert;

/**
 * Abuse reports (B4.4). A user flags review/reply content for the
 * moderation queue; a `reviews.manage` moderator triages oldest-pending-
 * first. The target is POLYMORPHIC (target_type + target_id) — a plain FK
 * cannot span two tables, so existence is validated in the service and a
 * hard-deleted target leaves the report standing (the audit trail of WHY
 * content vanished survives the content itself; the moderator dismisses
 * orphaned reports).
 *
 * One report per reporter per target (unique index): report VOLUME across
 * distinct users is the abuse signal — a single user cannot pump it.
 * `pending` rows are the queue; `reviewed`/`dismissed`/`actioned` are the
 * three resolutions (seen / no violation / violation handled). Reporter and
 * reviewer FKs cascade (personal data); reviewed_by is SET NULL (an admin
 * account removal must not erase the decision).
 */
export const reportTargetEnum = pgEnum('report_target_type', ['review', 'reply']);
export const reportCategoryEnum = pgEnum('report_category', [
  'spam',
  'offensive',
  'false_info',
  'other',
]);
export const reportStatusEnum = pgEnum('report_status', [
  'pending',
  'reviewed',
  'dismissed',
  'actioned',
]);

export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: reportCategoryEnum('category').notNull(),
    /** Required when category = 'other' (service rule); context otherwise. */
    details: text('details'),
    status: reportStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One report per reporter per target — cross-user volume stays the signal.
    uniqueIndex('content_reports_one_per_reporter').on(
      table.targetType,
      table.targetId,
      table.reporterUserId,
    ),
    // The moderation queue: oldest-pending-first triage (mirrors
    // reviews_status_created_idx from B4.1).
    index('content_reports_status_created_idx').on(table.status, table.createdAt.asc()),
    // All reports on one target (takedown sweeps, "why was this removed").
    index('content_reports_target_idx').on(table.targetType, table.targetId),
    // The reporter's own reports.
    index('content_reports_reporter_idx').on(table.reporterUserId, table.createdAt.desc()),
    check(
      'content_reports_details_len',
      sql`${table.details} IS NULL OR char_length(${table.details}) BETWEEN 2 AND 1000`,
    ),
    check(
      'content_reports_note_len',
      sql`${table.resolutionNote} IS NULL OR char_length(${table.resolutionNote}) BETWEEN 2 AND 1000`,
    ),
  ],
);

export type ContentReportRow = typeof contentReports.$inferSelect;
export type NewContentReportRow = typeof contentReports.$inferInsert;
