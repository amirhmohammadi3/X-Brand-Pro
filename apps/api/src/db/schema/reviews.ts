import {
  check,
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
    /** Stamped by the service when the author edits the review after creation. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
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
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type NewReviewRow = typeof reviews.$inferInsert;
