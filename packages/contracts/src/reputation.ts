import { z } from 'zod';

/**
 * B4.7 user reputation — the trust score behind the review-page badges and
 * the /users/me/reputation endpoint.
 *
 * The score is DERIVED FROM SOURCE and stored denormalised on
 * `users.reputation_points` (the B4.1 aggregate pattern): every reputation-
 * relevant review event (create/edit/delete/status flip/vote) enqueues ONE
 * `recompute-reputation` job per user (jobId-deduped); the worker recomputes
 * the three source counts and writes the points back. Incremental counters
 * would drift on takedowns/switches — a full recompute cannot.
 *
 * Points: an APPROVED review earns 10, a VERIFIED proof (check-in or
 * receipt, B4.6) on an approved review earns 25, a helpful vote RECEIVED on
 * an approved review earns 2. Unhelpful votes subtract nothing — their
 * signal is the helpful ratio and the B4.5/B4.4 moderation flow, not the
 * score (a user can never go below 0).
 */

export const REPUTATION_POINTS = {
  approvedReview: 10,
  verifiedReview: 25,
  helpfulVoteReceived: 2,
} as const;

/** Ordered thresholds — the LAST entry whose minPoints ≤ score wins. */
export const REPUTATION_LEVELS = [
  { level: 'newcomer', minPoints: 0 },
  { level: 'contributor', minPoints: 50 },
  { level: 'expert', minPoints: 200 },
  { level: 'veteran', minPoints: 500 },
] as const;

export const reputationLevelSchema = z.enum(['newcomer', 'contributor', 'expert', 'veteran']);
export type ReputationLevel = (typeof REPUTATION_LEVELS)[number]['level'];

/** Pure mapping score → level (shared by api + web; i18n owns the labels). */
export function reputationLevelFor(points: number): ReputationLevel {
  let current: ReputationLevel = REPUTATION_LEVELS[0].level;
  for (const entry of REPUTATION_LEVELS) {
    if (points >= entry.minPoints) current = entry.level;
  }
  return current;
}

/** The source counts one recompute aggregates. */
export const reputationStatsSchema = z.object({
  approvedReviews: z.number().int().min(0),
  verifiedReviews: z.number().int().min(0),
  helpfulVotesReceived: z.number().int().min(0),
});
export type ReputationStats = z.infer<typeof reputationStatsSchema>;

/** Pure mapping stats → points (the worker and the read endpoint share it). */
export function reputationPointsFor(stats: ReputationStats): number {
  return (
    stats.approvedReviews * REPUTATION_POINTS.approvedReview +
    stats.verifiedReviews * REPUTATION_POINTS.verifiedReview +
    stats.helpfulVotesReceived * REPUTATION_POINTS.helpfulVoteReceived
  );
}

/** GET /users/me/reputation — the caller's score, level and source stats. */
export const userReputationSchema = z.object({
  points: z.number().int().min(0),
  level: reputationLevelSchema,
  stats: reputationStatsSchema,
});
export type UserReputation = z.infer<typeof userReputationSchema>;
