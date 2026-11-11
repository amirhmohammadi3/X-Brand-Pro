import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationsService } from './notifications.service.js';
import {
  BUSINESSES_REPOSITORY,
  type BusinessesRepositoryLike,
} from '../business/businesses.repository.js';
import { QA_REPOSITORY, type QaRepositoryLike } from '../qa/qa.repository.js';
import { REVIEWS_REPOSITORY, type ReviewsRepositoryLike } from '../reviews/reviews.repository.js';
import { USERS_REPOSITORY } from '../users/users.service.js';
import type { UsersRepositoryLike } from '../users/users.repository.js';

/**
 * Minimal event payload shapes — the wire format the source modules emit
 * (reviews.service B4.2/B4.3, qa.service B4.8, follows.service B5.2,
 * favorites.service B5.1). Kept inline (not imported) so a payload change
 * upstream surfaces as a type error HERE instead of silently coupling the
 * modules (the follows-activity subscriber precedent).
 */
interface ReviewRepliedPayload {
  reviewId: string;
  businessId: string;
  replyId: string;
  /** The replier (business owner at reply time). */
  userId: string;
}
interface ReviewVotedPayload {
  reviewId: string;
  businessId: string;
  /** The voter. */
  userId: string;
  /** The review author — the notification recipient (B4.7's score target). */
  authorId: string;
  value: number;
}
interface QuestionAnsweredPayload {
  questionId: string;
  businessId: string;
  answerId: string;
  /** The answerer (business owner at answer time). */
  userId: string;
}
interface FollowCreatedPayload {
  followerId: string;
  kind: 'user' | 'business';
  targetId: string;
}
interface FavoriteAddedPayload {
  /** The user who saved the business. */
  userId: string;
  businessId: string;
  listId: string;
  itemId: string;
}

/**
 * Event → notification wiring (B5.7). One subscriber per module graph
 * position: the notifications module consumes the EXISTING domain events
 * through the @Global EventEmitter2 and calls `notify()` — the ONE
 * entry point B5.3 built. The catalog v1 (contracts NOTIFICATION_EVENT_KEYS)
 * is wired 1:1:
 *
 * - `review.replied`     → the review author («{actor} به نقد شما دربارهٔ {business} پاسخ داد.»)
 * - `review.voted`       → the review author (payload carries `authorId` — B4.7's score target)
 * - `question.answered`  → the asker
 * - `follow.created`     → the followed USER (business follows stay silent in v1 —
 *   the catalog has no business-follower event; the owner-facing surface is
 *   `business.favorited`)
 * - `business.favorited` → the business OWNER (the owner relationship read
 *   from the businesses repository, never guessed from the event)
 *
 * Rules:
 * - BEST-EFFORT, always: a lookup failure, an unknown recipient or a
 *   notify() hiccup is logged and swallowed — a notification must never
 *   break the review/vote/answer/follow/favorite write that triggered it
 *   (notify() itself is fail-soft; this wrapper guards the LOOKUPS);
 * - no self-notifications: replying to your own review, voting your own
 *   review, answering your own question, saving your own business deliver
 *   nothing;
 * - only `active` recipients get rows (a banned/deleted user's catalog
 *   matrix is never consulted);
 * - the {actor}/{business} template vars render from the SAME lookups the
 *   feed/subscribers use (username/displayName + business name) — no new
 *   denormalized fields, no new migrations.
 */
@Injectable()
export class NotificationsEventsSubscriber {
  private readonly logger = new Logger(NotificationsEventsSubscriber.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepositoryLike,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
    @Inject(REVIEWS_REPOSITORY) private readonly reviews: ReviewsRepositoryLike,
    @Inject(QA_REPOSITORY) private readonly qa: QaRepositoryLike,
  ) {}

  @OnEvent('review.replied')
  async handleReviewReplied(payload: unknown): Promise<void> {
    const p = payload as Partial<ReviewRepliedPayload> | null;
    if (!p?.reviewId || !p.userId || !p.businessId) return;
    try {
      const review = await this.reviews.findById(p.reviewId);
      if (!review || review.userId === p.userId) return; // no self-notifications
      if (!(await this.isActive(review.userId))) return;
      const vars = await this.actorBusinessVars(p.userId, p.businessId);
      if (!vars) return;
      await this.notifications.notify({
        userId: review.userId,
        eventKey: 'review.replied',
        vars,
      });
    } catch (error) {
      this.logger.warn(
        `review.replied notification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @OnEvent('review.voted')
  async handleReviewVoted(payload: unknown): Promise<void> {
    const p = payload as Partial<ReviewVotedPayload> | null;
    if (!p?.authorId || !p.userId || !p.businessId) return;
    if (p.authorId === p.userId) return; // self-vote (also refused upstream)
    try {
      if (!(await this.isActive(p.authorId))) return;
      const business = await this.businesses.findById(p.businessId);
      if (!business) return;
      await this.notifications.notify({
        userId: p.authorId,
        eventKey: 'review.voted',
        vars: { business: business.name },
      });
    } catch (error) {
      this.logger.warn(
        `review.voted notification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @OnEvent('question.answered')
  async handleQuestionAnswered(payload: unknown): Promise<void> {
    const p = payload as Partial<QuestionAnsweredPayload> | null;
    if (!p?.questionId || !p.userId || !p.businessId) return;
    try {
      const question = await this.qa.findQuestionById(p.questionId);
      if (!question || question.userId === p.userId) return; // no self-notifications
      if (!(await this.isActive(question.userId))) return;
      const business = await this.businesses.findById(p.businessId);
      if (!business) return;
      await this.notifications.notify({
        userId: question.userId,
        eventKey: 'question.answered',
        vars: { business: business.name },
      });
    } catch (error) {
      this.logger.warn(
        `question.answered notification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @OnEvent('follow.created')
  async handleFollowCreated(payload: unknown): Promise<void> {
    const p = payload as Partial<FollowCreatedPayload> | null;
    if (!p?.followerId || !p.targetId || !p.kind) return;
    // v1: user follows only (the catalog's «دنبال‌کنندهٔ جدید» is user-facing;
    // a business follow has no owner-facing catalog key yet).
    if (p.kind !== 'user' || p.targetId === p.followerId) return;
    try {
      if (!(await this.isActive(p.targetId))) return;
      const actor = await this.users.findById(p.followerId);
      if (!actor || actor.status !== 'active') return; // a vanished follower is not an actor
      await this.notifications.notify({
        userId: p.targetId,
        eventKey: 'follow.created',
        vars: { actor: this.actorName(actor) },
      });
    } catch (error) {
      this.logger.warn(
        `follow.created notification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @OnEvent('favorite.added')
  async handleFavoriteAdded(payload: unknown): Promise<void> {
    const p = payload as Partial<FavoriteAddedPayload> | null;
    if (!p?.businessId || !p.userId) return;
    try {
      const business = await this.businesses.findById(p.businessId);
      // An unclaimed business has no owner to notify; a self-save is silent.
      if (!business || !business.ownerId || business.ownerId === p.userId) return;
      if (!(await this.isActive(business.ownerId))) return;
      const actor = await this.users.findById(p.userId);
      if (!actor || actor.status !== 'active') return;
      await this.notifications.notify({
        userId: business.ownerId,
        eventKey: 'business.favorited',
        vars: { actor: this.actorName(actor), business: business.name },
      });
    } catch (error) {
      this.logger.warn(
        `business.favorited notification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The {actor}/{business} var pair shared by reply + favorite templates. */
  private async actorBusinessVars(
    actorId: string,
    businessId: string,
  ): Promise<{ actor: string; business: string } | null> {
    const [actor, business] = await Promise.all([
      this.users.findById(actorId),
      this.businesses.findById(businessId),
    ]);
    if (!actor || actor.status !== 'active' || !business) return null;
    return { actor: this.actorName(actor), business: business.name };
  }

  private actorName(user: { displayName: string | null; username: string }): string {
    return user.displayName?.trim() || user.username;
  }

  /** Only `active` users receive notifications (banned/deleted are skipped). */
  private async isActive(userId: string): Promise<boolean> {
    const row = await this.users.findById(userId);
    return row?.status === 'active';
  }
}
