import { z } from 'zod';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { uuidSchema } from './primitives.js';
import { businessSummarySchema } from './business.js';

/**
 * Follows and the activity feed (B5.2). One `follows` table covers BOTH
 * target kinds: a row carries follower_id + exactly ONE of (business_id,
 * user_id) — the `follows_one_target` CHECK keeps the row domain closed and
 * the two partial unique indexes (`follows_business_unq`,
 * `follows_user_unq`) make a double follow impossible; a second POST is a
 * 409 and unfollowing is DELETE (the same toggle-heart semantics as B5.1).
 *
 * The feed is PULL-BASED: `activity_events` is one append-only row per
 * public action (review created, question created/answered, favorite
 * added), written by a best-effort subscriber ON the existing domain events
 * (B4.1/B4.8/B5.1) — source writes never wait on the feed and a feed
 * failure never breaks a review. Feed reads join the ACTORS the caller
 * follows (users + businesses); pagination is page-based like every list.
 *
 * Visibility rules mirrored from the existing domains: only `active`
 * non-deleted businesses accept follows; only `active` users accept follows
 * AND appear in feeds (a blocked actor's rows vanish from reads without a
 * cleanup job); a review demoted out of `approved` loses its activity row
 * (subscriber deletes on review.status.changed / review.deleted), so the
 * feed can never point at content the public pages no longer serve.
 */

/** Per-user follows cap (both kinds combined) — abuse bound, not a UX promise. */
export const FOLLOW_MAX_PER_USER = 1000;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - follow/unfollow are single-row writes → 30/min per user (the B5.1
 *   write budget);
 * - feed/follows reads → 60/min per user (scope user, same reasoning as
 *   favorites: private data, strangers cannot burn each other's budget).
 */
export const FOLLOW_WRITE_LIMIT_PER_MIN = 30;
export const FOLLOW_READ_LIMIT_PER_MIN = 60;

/** The four public actions the feed records (kept in contracts so the web renders them). */
export const ACTIVITY_TYPES = [
  'review.created',
  'question.created',
  'question.answered',
  'favorite.added',
] as const;
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** A followed user as served by GET /follows/me (newest follow first). */
export const followedUserSchema = z
  .object({
    id: uuidSchema,
    username: z.string().min(3),
    displayName: z.string().min(1).nullable(),
    avatarUrl: z.string().min(1).nullable(),
    followedAt: z.string(),
  })
  .strict();
export type FollowedUser = z.infer<typeof followedUserSchema>;

/** A followed business: the full B2.4 card + the follow stamp. */
export const followedBusinessSchema = z
  .object({
    business: businessSummarySchema,
    followedAt: z.string(),
  })
  .strict();
export type FollowedBusiness = z.infer<typeof followedBusinessSchema>;

/** GET /follows/me — both lists, newest follows first, active rows only. */
export const myFollowsResultSchema = z
  .object({
    users: z.array(followedUserSchema),
    businesses: z.array(followedBusinessSchema),
  })
  .strict();
export type MyFollowsResult = z.infer<typeof myFollowsResultSchema>;

/** POST/DELETE result — the toggle's new state (mirrors the favorite status shape). */
export const followResultSchema = z
  .object({
    kind: z.enum(['user', 'business']),
    targetId: uuidSchema,
    following: z.boolean(),
  })
  .strict();
export type FollowResult = z.infer<typeof followResultSchema>;

/** One feed row: the actor, the (optional) business context and the subject id. */
export const feedItemSchema = z
  .object({
    id: uuidSchema,
    type: activityTypeSchema,
    actor: z
      .object({
        id: uuidSchema,
        username: z.string().min(3),
        displayName: z.string().min(1).nullable(),
        avatarUrl: z.string().min(1).nullable(),
      })
      .strict(),
    /** The business the action happened on (null for user-only events — none today, kept for forward compatibility). */
    business: z
      .object({
        id: uuidSchema,
        slug: z.string(),
        name: z.string().min(1),
      })
      .strict()
      .nullable(),
    /** The content id the item points at: reviewId / questionId / favorite itemId. */
    subjectId: uuidSchema.nullable(),
    createdAt: z.string(),
  })
  .strict();
export type FeedItem = z.infer<typeof feedItemSchema>;

/** GET /feed — the caller's home feed (followed users + followed businesses). */
export const feedResultSchema = z
  .object({
    items: z.array(feedItemSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type FeedResult = z.infer<typeof feedResultSchema>;

/** GET /feed query — optional type filter (the tabs in F5.2). */
export const feedQuerySchema = pageQuerySchema.extend({
  type: activityTypeSchema.optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;
