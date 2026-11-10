import { z } from 'zod';
import { pageQuerySchema, pageMetaSchema } from './pagination.js';
import { uuidSchema } from './primitives.js';

/**
 * Reviews (B4.1). An authenticated user rates (1..5) and reviews an ACTIVE
 * business — one review per user per business (unique index; a second attempt
 * is a 409 and the caller edits their existing review instead). A review may
 * carry one photo (uploaded through B1.9's POST /media/upload, kind
 * `review_photo`).
 *
 * Lifecycle: reviews are created `approved` (visible + counted immediately);
 * `pending`/`rejected` exist for the moderation prompts (B4.4 moderation
 * queue, B4.5 spam filter) to flip rows into without a migration. ONLY
 * `approved` reviews count toward `businesses.avg_rating`/`review_count`
 * (recomputed asynchronously on the `reviews` queue — the aggregate is
 * eventually consistent by design, never inline in the request path).
 */

export const REVIEW_STATUSES = ['approved', 'pending', 'rejected'] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/**
 * B4.3 owner reply. The business owner (matched by `businesses.owner_id`,
 * or a `businesses.manage` holder) answers a review with ONE reply —
 * `review_replies_one_per_review` (unique on review_id) makes a second PUT
 * an EDIT of the same row, never a thread. Replies only attach to APPROVED
 * reviews (pending/rejected are invisible to the public page → 422, the
 * same rule as votes). The reply is served inline on every review object
 * (`reply: ReviewReply | null`) so the business page needs no extra calls.
 */
export const REPLY_BODY_MIN = 2;
export const REPLY_BODY_MAX = 1000;

/** One owner reply as served inside a Review. */
export const reviewReplySchema = z.object({
  id: uuidSchema,
  reviewId: uuidSchema,
  /** The replier at write time — provenance only (an ownership transfer does NOT block further edits). */
  userId: uuidSchema,
  /** Replier's public display name (users.display_name at read time). */
  authorName: z.string().min(1).nullable(),
  body: z.string().min(REPLY_BODY_MIN).max(REPLY_BODY_MAX),
  /** Stamped when an allowed caller edits the reply after creation. */
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReviewReply = z.infer<typeof reviewReplySchema>;

/** PUT /reviews/:id/reply body. */
export const upsertReviewReplyBodySchema = z
  .object({ body: z.string().min(REPLY_BODY_MIN).max(REPLY_BODY_MAX) })
  .strict();
export type UpsertReviewReplyBody = z.infer<typeof upsertReviewReplyBodySchema>;

/** Upsert semantics: `created` distinguishes the first reply from an edit. */
export const upsertReviewReplyResultSchema = z.object({
  reply: reviewReplySchema,
  created: z.boolean(),
});
export type UpsertReviewReplyResult = z.infer<typeof upsertReviewReplyResultSchema>;

/** DELETE /reviews/:id/reply — idempotent (no reply → `{ deleted: false }`). */
export const deleteReviewReplyResultSchema = z.object({ deleted: z.boolean() });
export type DeleteReviewReplyResult = z.infer<typeof deleteReviewReplyResultSchema>;

/** One review as served by the review endpoints. */
export const reviewSchema = z.object({
  id: uuidSchema,
  businessId: uuidSchema,
  userId: uuidSchema,
  /** Author's public display name (users.display_name — denormalised for the list). */
  authorName: z.string().min(1).nullable(),
  /** Author's username — always present; the UI falls back to it when displayName is null. */
  authorUsername: z.string().min(3),
  rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX),
  body: z.string().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX),
  status: reviewStatusSchema,
  /** Public URL of the attached review photo, when one was attached. */
  photoUrl: z.string().min(1).nullable(),
  /** Helpful votes (B4.2) — recomputed per read, never cached client-side. */
  helpfulCount: z.number().int().min(0),
  /** Unhelpful votes (B4.2) — same lifecycle as helpfulCount. */
  unhelpfulCount: z.number().int().min(0),
  /** Set when the author edited the review after creation. */
  editedAt: z.string().nullable(),
  /** The owner's reply (B4.3) — null until the business answers. */
  reply: reviewReplySchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * Vote values (B4.2): `1` = helpful, `-1` = unhelpful. ONE vote per user per
 * review (unique index) — re-voting with the same value is an idempotent
 * no-op, the opposite value switches the vote, `DELETE` withdraws it.
 */
export const REVIEW_VOTE_HELPFUL = 1;
export const REVIEW_VOTE_UNHELPFUL = -1;
export const reviewVoteValueSchema = z.union([
  z.literal(REVIEW_VOTE_HELPFUL),
  z.literal(REVIEW_VOTE_UNHELPFUL),
]);
export type ReviewVoteValue = z.infer<typeof reviewVoteValueSchema>;

/** PUT /reviews/:id/vote body. */
export const reviewVoteBodySchema = z.object({ value: reviewVoteValueSchema }).strict();
export type ReviewVoteBody = z.infer<typeof reviewVoteBodySchema>;

/** Vote endpoints answer with the fresh counts + the caller's current vote. */
export const reviewVoteResultSchema = z.object({
  helpful: z.number().int().min(0),
  unhelpful: z.number().int().min(0),
  myVote: reviewVoteValueSchema.nullable(),
});
export type ReviewVoteResult = z.infer<typeof reviewVoteResultSchema>;

/** Create body — the photo rides /media/upload (kind `review_photo`). */
export const createReviewBodySchema = z
  .object({
    rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX),
    body: z.string().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX),
    /** Media id from POST /media/upload (kind `review_photo`), owned by the caller. */
    photoMediaId: uuidSchema.optional(),
  })
  .strict();
export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;

/**
 * Edit body — the author may change the rating, text and photo. `photoMediaId`
 * is nullable here: `undefined` keeps the current photo, `null` clears it,
 * a media id replaces it.
 */
export const updateReviewBodySchema = z
  .object({
    rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX).optional(),
    body: z.string().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX).optional(),
    photoMediaId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateReviewBody = z.infer<typeof updateReviewBodySchema>;

/** Public list query (business page). `status` filter is `reviews.manage`-only. */
export const reviewListQuerySchema = pageQuerySchema.extend({
  status: reviewStatusSchema.optional(),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

/** Page-based review list. */
export const reviewListResultSchema = z.object({
  items: z.array(reviewSchema),
  meta: pageMetaSchema,
});
export type ReviewListResult = z.infer<typeof reviewListResultSchema>;

/** The caller's own reviews (all statuses), newest first. */
export const myReviewsResultSchema = z.object({
  items: z.array(reviewSchema),
  meta: pageMetaSchema,
});
export type MyReviewsResult = z.infer<typeof myReviewsResultSchema>;

/** { deleted: n } shape for the delete endpoint (mirrors claims/search history). */
export const deleteReviewResultSchema = z.object({ deleted: z.boolean() });
export type DeleteReviewResult = z.infer<typeof deleteReviewResultSchema>;

/**
 * B4.2 vote rules (single source of truth for service + tests):
 * - votes only on APPROVED reviews (pending/rejected are invisible → 422);
 * - no self-votes (a helpful score is social proof from OTHERS → 422).
 */
export const REVIEW_VOTE_LIMIT_PER_MIN = 30;

/**
 * B4.3 reply rules (single source of truth for service + tests):
 * - replies only by the business owner (owner_id match, owner-editable
 *   status) or a `businesses.manage` holder — `reviews.manage` moderators
 *   may TAKEDOWN a reply (delete) but never speak for the business;
 * - replies only on APPROVED reviews (422 otherwise);
 * - the reply's author may also delete their own reply (e.g. after an
 *   ownership transfer they no longer manage the business).
 */
export const REVIEW_REPLY_LIMIT_PER_MIN = 30;
