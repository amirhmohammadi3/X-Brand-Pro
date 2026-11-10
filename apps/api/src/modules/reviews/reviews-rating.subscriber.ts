import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QUEUES_SERVICE } from '../../queue/queue.module.js';
import type { QueuesService } from '../../queue/queues.service.js';
import { REVIEWS_QUEUE, RECOMPUTE_RATING_JOB } from './reviews.jobs.js';
import { REVIEWS_EVENTS } from './reviews.service.js';

interface ReviewChangedEvent {
  businessId: string;
}

/**
 * Enqueue-side of the rating aggregation (B4.1). Every review write
 * (create/edit/delete) emits `review.*` (ReviewsService); THIS subscriber —
 * the module that reacts (AGENTS.md 6) — turns it into ONE
 * `recompute-rating` job per business. The jobId is the businessId, so a
 * burst of writes (import, spam sweep) collapses into a single waiting job;
 * the worker recomputes from source, so ordering/collapsing can never drift
 * the aggregate (it is a full recompute, not incremental).
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
  }
}
