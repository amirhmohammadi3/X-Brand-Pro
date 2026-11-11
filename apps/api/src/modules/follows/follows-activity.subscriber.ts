import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ActivityType } from '@app/contracts';
import { FOLLOWS_REPOSITORY, type FollowsRepositoryLike } from './follows.repository.js';

/**
 * Minimal event payload shapes — the wire format the source modules emit
 * (reviews.service B4.1, qa.service B4.8, favorites.service B5.1). Kept
 * inline (not imported) so a payload change upstream surfaces as a type
 * error HERE instead of silently coupling the modules.
 */
interface ReviewCreatedPayload {
  reviewId: string;
  businessId: string;
  userId: string;
}
interface ReviewStatusChangedPayload {
  reviewId: string;
  businessId: string;
  userId: string;
  from: string;
  to: string;
}
interface QuestionEventPayload {
  questionId: string;
  businessId: string;
  userId: string;
}
interface AnswerEventPayload extends QuestionEventPayload {
  answerId: string;
}
interface FavoriteEventPayload {
  userId: string;
  businessId: string;
  listId: string;
  itemId: string;
}

/**
 * Activity subscriber (B5.2) — turns the EXISTING domain events into
 * activity_events rows for the pull-based feed. Rules:
 * - BEST-EFFORT, always: a feed failure must never break the source write
 *   (the review/question/favorite flows run for real; this handler catches
 *   everything and logs via console-free pino? — it silently retriable
 *   drops: the feed is a read-convenience, not a ledger);
 * - a review DEMOTED out of `approved` (moderation takedown, spam flag,
 *   delete) RETRACTS its feed row — the feed must never advertise content
 *   the public pages no longer serve; a re-approval re-inserts it
 *   (ensureActivityEvent is idempotent on (type, subject_id));
 * - question.answered maps the feed row to the QUESTION (one answer per
 *   question — B4.8), so its answer.deleted retracts the same row.
 *
 * Only four activity types exist (see contracts ACTIVITY_TYPES); every
 * other event (votes, replies, edits, reputation) stays out of the feed —
 * the home feed shows what a followed user/business DID, not every ripple.
 */
@Injectable()
export class FollowsActivitySubscriber {
  constructor(@Inject(FOLLOWS_REPOSITORY) private readonly repo: FollowsRepositoryLike) {}

  @OnEvent('review.created')
  onReviewCreated(payload: ReviewCreatedPayload): void {
    this.bestEffort(() =>
      this.repo.ensureActivityEvent({
        actorId: payload.userId,
        type: 'review.created',
        businessId: payload.businessId,
        subjectId: payload.reviewId,
      }),
    );
  }

  @OnEvent('review.deleted')
  onReviewDeleted(payload: ReviewCreatedPayload): void {
    this.bestEffort(() => this.repo.deleteActivityEventsBy('review.created', payload.reviewId));
  }

  @OnEvent('review.status.changed')
  onReviewStatusChanged(payload: ReviewStatusChangedPayload): void {
    this.bestEffort(() =>
      payload.to === 'approved'
        ? this.repo.ensureActivityEvent({
            actorId: payload.userId,
            type: 'review.created',
            businessId: payload.businessId,
            subjectId: payload.reviewId,
          })
        : this.repo.deleteActivityEventsBy('review.created', payload.reviewId),
    );
  }

  @OnEvent('question.created')
  onQuestionCreated(payload: QuestionEventPayload): void {
    this.bestEffort(() =>
      this.repo.ensureActivityEvent({
        actorId: payload.userId,
        type: 'question.created',
        businessId: payload.businessId,
        subjectId: payload.questionId,
      }),
    );
  }

  @OnEvent('question.deleted')
  onQuestionDeleted(payload: QuestionEventPayload): void {
    this.bestEffort(() => this.repo.deleteActivityEventsBy('question.created', payload.questionId));
  }

  @OnEvent('question.answered')
  onQuestionAnswered(payload: AnswerEventPayload): void {
    this.bestEffort(() =>
      this.repo.ensureActivityEvent({
        actorId: payload.userId,
        type: 'question.answered',
        businessId: payload.businessId,
        subjectId: payload.questionId,
      }),
    );
  }

  @OnEvent('question.answer.deleted')
  onAnswerDeleted(payload: AnswerEventPayload): void {
    this.bestEffort(() =>
      this.repo.deleteActivityEventsBy('question.answered', payload.questionId),
    );
  }

  @OnEvent('favorite.added')
  onFavoriteAdded(payload: FavoriteEventPayload): void {
    this.bestEffort(() =>
      this.repo.ensureActivityEvent({
        actorId: payload.userId,
        type: 'favorite.added',
        businessId: payload.businessId,
        subjectId: payload.itemId,
      }),
    );
  }

  @OnEvent('favorite.removed')
  onFavoriteRemoved(payload: FavoriteEventPayload): void {
    this.bestEffort(() => this.repo.deleteActivityEventsBy('favorite.added', payload.itemId));
  }

  /** Every handler is fire-and-forget: a failing feed write is DROPPED. */
  private bestEffort(fn: () => Promise<void>): void {
    void fn().catch(() => undefined);
  }
}

/** Re-exported for the module's provider list readability. */
export type { ActivityType };
