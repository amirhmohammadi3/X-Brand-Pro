import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
// FraudScoreService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FraudScoreService } from './fraud-score.service.js';

/**
 * Review events subscriber (A9.6) — generates / regenerates the AI fraud
 * score on review changes so the moderation queue always has a fresh
 * score.
 *
 * Best-effort: a subscriber failure must NEVER break the source write.
 *
 * Listened events:
 *  - review.created — generate an initial score (fire-and-forget).
 *  - review.updated — mark the existing score stale (the next moderation-
 *    queue read regenerates).
 *
 * NOT listened:
 *  - review.deleted — the FK cascades the score row away.
 *  - review.status.changed — a moderation flip doesn't change the body, so
 *    the score is unchanged (the score column still surfaces the review
 *    in the queue regardless of its moderation status).
 *  - review.voted / voted / replied / verified — these don't change the
 *    body.
 */
@Injectable()
export class FraudScoreSubscriber {
  private readonly logger = new Logger(FraudScoreSubscriber.name);

  constructor(private readonly fraudService: FraudScoreService) {}

  @OnEvent('review.created')
  onReviewCreated(payload: { reviewId: string }): void {
    this.bestEffort(payload.reviewId, 'review.created');
  }

  @OnEvent('review.updated')
  onReviewUpdated(payload: { reviewId: string }): void {
    this.bestEffort(payload.reviewId, 'review.updated');
  }

  private bestEffort(reviewId: string, event: string): void {
    void this.fraudService.onReviewChanged(reviewId).catch((err) => {
      this.logger.error(
        `fraud-score subscriber failed (event=${event} reviewId=${reviewId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
