import { check, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { users } from './users.js';

/**
 * Follows and the activity feed (B5.2). Two tables:
 *
 * - `follows` — one table for BOTH target kinds: `follower_id` + exactly
 *   ONE of (`business_id`, `user_id`) — the `follows_one_target` CHECK
 *   (num_nonnulls = 1) keeps the row domain closed. The per-target unique
 *   indexes (`follows_business_unq`, `follows_user_unq`) make a double
 *   follow impossible at the storage layer (a second POST is a 409, the
 *   same toggle semantics as B5.1's favorites). A user who follows a
 *   business appears on the business's follower list via
 *   `follows_business_idx`; user-to-user follows use
 *   `follows_target_user_idx` (profile "followers" reads) and
 *   `follows_follower_idx` (GET /follows/me).
 *
 * - `activity_events` — the PULL-BASED feed's append-only source: ONE row
 *   per public action, written best-effort by a subscriber ON the existing
 *   domain events (review.created, question.created/answered,
 *   favorite.added) — never inline in the request path. `subject_id` is
 *   deliberately NOT a foreign key: it is polymorphic (a review id, a
 *   question id or a favorite item id) and the (type, subject_id) index is
 *   exactly the lookup the delete-on-source-event handlers need. The
 *   business FK CASCADEs (a deleted business takes its feed rows with it —
 *   the feed can never point at a dead page); the actor FK CASCADEs on
 *   user deletion.
 *
 * Visibility is enforced at READ time, not by cleanup: only `active` actors
 * join the feed (a blocked user's rows vanish from reads without any job),
 * and the subscriber deletes a review's activity row when the review leaves
 * `approved` (status change / delete), so the feed never advertises content
 * the public pages no longer serve.
 */
export const activityTypeEnum = pgEnum('activity_type', [
  'review.created',
  'question.created',
  'question.answered',
  'favorite.added',
]);

export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set when the target is a business (user_id is then NULL, and vice versa). */
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('follows_one_target', sql`num_nonnulls(${table.businessId}, ${table.userId}) = 1`),
    // ONE follow per (follower, target) — the toggle's 409 source.
    uniqueIndex('follows_business_unq').on(table.followerId, table.businessId),
    uniqueIndex('follows_user_unq').on(table.followerId, table.userId),
    // GET /follows/me: newest follows first per follower.
    index('follows_follower_idx').on(table.followerId, table.createdAt.desc(), table.id),
    // Business followers (count + list, newest first).
    index('follows_business_idx').on(table.businessId, table.createdAt.desc()),
    // Profile followers (count + list, newest first).
    index('follows_target_user_idx').on(table.userId, table.createdAt.desc()),
  ],
);

export type FollowRow = typeof follows.$inferSelect;
export type NewFollowRow = typeof follows.$inferInsert;

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull(),
    /** The business context (null only for user-only future events). */
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    /** Polymorphic subject: reviewId | questionId | favorite itemId (NOT an FK). */
    subjectId: uuid('subject_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The home feed scan: per actor, newest first (id is the stable tiebreak).
    index('activity_events_actor_created_idx').on(table.actorId, table.createdAt.desc(), table.id),
    // Per-business activity (a future business-page timeline).
    index('activity_events_business_created_idx').on(table.businessId, table.createdAt.desc()),
    // Delete-on-source-event lookup: find the feed rows a review/question/
    // favorite removal must retract, by (type, subject).
    index('activity_events_subject_idx').on(table.type, table.subjectId),
  ],
);

export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type NewActivityEventRow = typeof activityEvents.$inferInsert;
