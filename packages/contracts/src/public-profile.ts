import { z } from 'zod';
import { pageMetaSchema } from './pagination.js';
import { reputationLevelSchema, reputationStatsSchema } from './reputation.js';
import { reviewSchema } from './reviews.js';

/**
 * B4.10 — the PUBLIC user profile (F4.8 renders it). Deliberately MINIMAL:
 * identity (username + display name + avatar), the trust signals the review
 * domain derives (B4.7 level + source stats) and the join date. NO email,
 * NO phone, NO reputation POINTS (the raw gamification score is self-only —
 * GET /users/me/reputation; the public page shows the level, which is what
 * the badge renders) and NO ban/moderation state (a blocked user 404s —
 * existence is never leaked).
 */

export const publicProfileSchema = z.object({
  username: z.string().min(3),
  /** Public display name (users.display_name — null until the user sets one). */
  displayName: z.string().min(1).nullable(),
  /** Resolved avatar media URL, null when the user has none. */
  avatarUrl: z.string().min(1).nullable(),
  /** The B4.7 reputation level derived from the denormalised score. */
  level: reputationLevelSchema,
  /** The live source stats behind the score (approved / verified reviews, helpful votes received). */
  stats: reputationStatsSchema,
  /** Profile creation date (ISO) — the «عضو از …» line. */
  joinedAt: z.string(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/**
 * GET /users/:username/reviews — the user's APPROVED reviews only (newest
 * first, paginated). pending/rejected rows are invisible publicly — the
 * caller's own every-status list stays on GET /reviews/me.
 */
export const publicProfileReviewsResultSchema = z.object({
  items: z.array(reviewSchema),
  meta: pageMetaSchema,
});
export type PublicProfileReviewsResult = z.infer<typeof publicProfileReviewsResultSchema>;
