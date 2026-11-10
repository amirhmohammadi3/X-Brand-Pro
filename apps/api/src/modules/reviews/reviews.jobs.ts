import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { WorkersService } from '../../queue/workers.service.js';
import {
  REVIEWS_QUEUE,
  RECOMPUTE_RATING_JOB,
  RECOMPUTE_REPUTATION_JOB,
} from './reviews.service.js';
import type { ReviewsService } from './reviews.service.js';

const logger = new Logger('ReviewsJobs');

const recomputeJobSchema = z.object({ businessId: z.string().uuid() });
const reputationJobSchema = z.object({ userId: z.string().uuid() });

/**
 * Parse + run one recompute-rating job. Exported so the HTTP tests can wire
 * the SAME handler into their inline queue double (no Redis in the sandbox):
 * enqueue → InlineQueuesService → handleRecomputeRating → service.
 */
export async function handleRecomputeRating(
  data: unknown,
  reviews: Pick<ReviewsService, 'recomputeRating'>,
): Promise<void> {
  const parsed = recomputeJobSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(`ignoring malformed recompute-rating job: ${parsed.error.message}`);
    return;
  }
  const agg = await reviews.recomputeRating(parsed.data.businessId);
  logger.log(
    `recompute-rating ${parsed.data.businessId} → avg ${agg.avgRating} (${agg.reviewCount})`,
  );
}

/**
 * B4.7 — parse + run one recompute-reputation job (same inline-testable
 * scheme). Full recompute from source onto users.reputation_points.
 */
export async function handleRecomputeReputation(
  data: unknown,
  reviews: Pick<ReviewsService, 'recomputeReputation'>,
): Promise<void> {
  const parsed = reputationJobSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(`ignoring malformed recompute-reputation job: ${parsed.error.message}`);
    return;
  }
  const rep = await reviews.recomputeReputation(parsed.data.userId);
  logger.log(`recompute-reputation ${parsed.data.userId} → ${rep.points} pts (${rep.level})`);
}

/**
 * Worker-side registration of the `reviews` queue (B4.1). Registration is
 * inert in the API process (startAll() runs only in the worker) and safe to
 * repeat across restarts. Jobs: `recompute-rating` (B4.1 — the full
 * AVG/COUNT recompute of a business onto businesses.avg_rating/review_count)
 * and `recompute-reputation` (B4.7 — the same scheme for the author's score).
 */
export function registerReviewsJobs(
  workers: WorkersService,
  reviews: Pick<ReviewsService, 'recomputeRating' | 'recomputeReputation'>,
): void {
  workers.register(REVIEWS_QUEUE, async (job) => {
    if (job.name === RECOMPUTE_RATING_JOB) {
      await handleRecomputeRating(job.data, reviews);
      return;
    }
    if (job.name === RECOMPUTE_REPUTATION_JOB) {
      await handleRecomputeReputation(job.data, reviews);
      return;
    }
    logger.warn(`ignoring unknown reviews job name "${job.name}"`);
  });
}

export { REVIEWS_QUEUE, RECOMPUTE_RATING_JOB, RECOMPUTE_REPUTATION_JOB };
