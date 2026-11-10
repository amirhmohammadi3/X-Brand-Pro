import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QUEUES_SERVICE } from '../../queue/queue.module.js';
import type { QueuesService } from '../../queue/queues.service.js';
import { REVIEWS_QUEUE, RECOMPUTE_RATING_JOB, RECOMPUTE_REPUTATION_JOB } from './reviews.jobs.js';
import { REVIEWS_EVENTS } from './reviews.service.js';

interface ReviewChangedEvent {
  businessId: string;
  /** B4.7 — the author whose reputation the write affects (present on every event the service emits). */
  userId?: string;
  authorId?: string;
}

/**
 * Enqueue-side of the aggregates (B4.1 + B4.7). Every review write emits
 * `review.*` (ReviewsService); THIS subscriber — the module that reacts
 * (AGENTS.md 6) — turns them into (a) ONE `recompute-rating` job per
 * business and (b) ONE `recompute-reputation` job per affected author.
 * The jobIds (`recompute:<businessId>` / `reputation:<userId>`) collapse
 * bursts into a single waiting job; the workers recompute FROM SOURCE, so
 * ordering/collapsing can never drift either aggregate (full recompute,
 * never incremental).
 */
@Injectable()
export class ReviewsRatingSubscriber {
  constructor(@Inject(QUEUES_SERVICE) private readonly queues: QueuesService) {}

  @OnEvent(REVIEWS_EVENTS.created)
  @OnEvent(REVIEWS_EVENTS.updated)
  @OnEvent(REVIEWS_EVENTS.deleted)
  @OnEvent(REVIEWS_EVENTS.statusChanged)
  async onReviewChanged(event: ReviewChangedEvent): Promise<void> {
    await this.queues.enqueue(REVIEWS_QUEUE, RECOMPUTE_RATING_JOB, event, {
      jobId: `recompute:${event.businessId}`,
    });
    this.enqueueReputation(event);
  }

  /** B4.2 votes shift the AUTHOR's helpful tally (B4.7), not the voter's. */
  @OnEvent(REVIEWS_EVENTS.voted)
  @OnEvent(REVIEWS_EVENTS.voteRemoved)
  onVoteChanged(event: ReviewChangedEvent): void {
    this.enqueueReputation(event);
  }

  /** B4.6 — the first proof flips the badge (and the +25 verified points). */
  @OnEvent(REVIEWS_EVENTS.verified)
  onVerified(event: ReviewChangedEvent): void {
    this.enqueueReputation(event);
  }

  private enqueueReputation(event: ReviewChangedEvent): void {
    const authorId = event.authorId ?? event.userId;
    if (!authorId) return;
    void this.queues
      .enqueue(
        REVIEWS_QUEUE,
        RECOMPUTE_REPUTATION_JOB,
        { userId: authorId },
        {
          jobId: `reputation:${authorId}`,
        },
      )
      .catch(() => undefined);
  }
}
