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
  /** Set when the author edited the review after creation. */
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

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
