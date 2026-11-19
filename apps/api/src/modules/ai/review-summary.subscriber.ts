import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
// ReviewSummaryService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewSummaryService } from './review-summary.service.js';

/**
 * Review events subscriber (A9.3) — marks the business's AI summary as
 * stale on review changes so the next read + the debounce sweep pick it
 * up for regeneration.
 *
 * Best-effort: a subscriber failure must NEVER break the source write
 * (the review CRUD flows run for real; this handler catches everything
 * + logs). The actual regenerate is async (debounced 60s) so the event
 * handler is non-blocking.
 *
 * Listened events:
 *  - review.created — a new review (always stale; even if `pending`, the
 *    approved count may have changed when it's later approved).
 *  - review.updated — a review body/rating edit (the summary text changes).
 *  - review.deleted — a review removal (the count changes).
 *  - review.status.changed — a moderation flip to/from `approved` (the
 *    summary scope changes).
 *
 * NOT listened (no impact on the summary):
 *  - review.voted / voteRemoved — votes don't change the text.
 *  - review.replied / replyUpdated / replyDeleted — replies are separate
 *    from the review body.
 *  - review.verified — the verification badge doesn't change the text.
 */
@Injectable()
export class ReviewSummarySubscriber {
  private readonly logger = new Logger(ReviewSummarySubscriber.name);

  constructor(private readonly summaryService: ReviewSummaryService) {}

  @OnEvent('review.created')
  onReviewCreated(payload: { businessId: string }): void {
    this.bestEffort(payload.businessId, 'review.created');
  }

  @OnEvent('review.updated')
  onReviewUpdated(payload: { businessId: string }): void {
    this.bestEffort(payload.businessId, 'review.updated');
  }

  @OnEvent('review.deleted')
  onReviewDeleted(payload: { businessId: string }): void {
    this.bestEffort(payload.businessId, 'review.deleted');
  }

  @OnEvent('review.status.changed')
  onReviewStatusChanged(payload: { businessId: string; to: string }): void {
    // Only mark stale when the new status is `approved` (a pending/rejected
    // review does not appear in the summary) OR when leaving `approved`
    // (the previously-approved review is now removed from the summary scope).
    if (payload.to === 'approved' || payload.to === 'pending' || payload.to === 'rejected') {
      this.bestEffort(payload.businessId, 'review.status.changed');
    }
  }

  private bestEffort(businessId: string, event: string): void {
    // Fire-and-forget — the subscriber must NEVER throw.
    void this.summaryService.onReviewChanged(businessId).catch((err) => {
      this.logger.error(
        `onReviewChanged failed (event=${event} businessId=${businessId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
