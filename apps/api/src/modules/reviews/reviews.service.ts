import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CreateReviewBody,
  DeleteReviewResult,
  MyReviewsResult,
  Review,
  ReviewListResult,
  ReviewVoteResult,
  ReviewVoteValue,
  UpdateReviewBody,
} from '@app/contracts';
import { MEDIA_REPOSITORY, type MediaRepositoryLike } from '../media/media.repository.js';
import { roleHasPermissions } from '../users/users.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import {
  REVIEWS_REPOSITORY,
  type ReviewWithMeta,
  type ReviewsRepositoryLike,
} from './reviews.repository.js';
import type { BusinessActor } from '../business/business-access.js';

/** Domain events (AGENTS.md 6 — the `review.created` example lives here). Subscriber: reviews-rating.subscriber.ts (enqueue); B4.4/B4.7 add theirs. */
export const REVIEWS_EVENTS = {
  created: 'review.created',
  updated: 'review.updated',
  deleted: 'review.deleted',
  /** B4.2 — a vote was cast or switched (payload carries the new value). */
  voted: 'review.voted',
  /** B4.2 — a vote was withdrawn. */
  voteRemoved: 'review.vote.removed',
} as const;

/** Permission that may delete (take down) any review — granted in ROLE_PERMISSIONS (admin/moderator/super_admin). */
export const REVIEWS_MANAGE_PERMISSION = 'reviews.manage';

/** BullMQ queue carrying the rating-aggregate recomputes (worker process only). */
export const REVIEWS_QUEUE = 'reviews';
/** The one B4.1 job on that queue: full AVG/COUNT recompute for one business. */
export const RECOMPUTE_RATING_JOB = 'recompute-rating';

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

function forbiddenException(message: string): HttpException {
  return new HttpException(
    { code: 'FORBIDDEN' as const, messageKey: 'errors.forbidden', message },
    HttpStatus.FORBIDDEN,
  );
}

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message,
      details,
    },
    HttpStatus.CONFLICT,
  );
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message,
      details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Reviews (B4.1). Rules:
 * - the business must exist and not be soft-deleted (404, never leaking
 *   existence) and be `active` to ACCEPT a new review (422);
 * - one review per user per business — a second create is 409 (edit instead);
 * - the photo must be kind `review_photo`, owned by the caller and unattached
 *   (the same attach rules as the business gallery, one media one home);
 * - edit is AUTHOR-only (admins moderate via status in B4.4, they do not
 *   rewrite user content); delete is author OR `reviews.manage`;
 * - every write emits a domain event; the rating aggregate is recomputed
 *   asynchronously on the `reviews` queue (see reviews-rating.subscriber.ts
 *   + reviews.jobs.ts) — never inline in the request path.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(REVIEWS_REPOSITORY) private readonly repo: ReviewsRepositoryLike,
    @Inject(MEDIA_REPOSITORY) private readonly mediaRepo: MediaRepositoryLike,
    private readonly mediaUrls: MediaUrlService,
    private readonly events: EventEmitter2,
  ) {}

  /** Public business page list: approved reviews, newest first, paginated. */
  async listByBusiness(
    businessId: string,
    query: { page: number; pageSize: number; status?: 'approved' | 'pending' | 'rejected' },
  ): Promise<ReviewListResult> {
    const page =
      query.status === undefined
        ? await this.repo.listByBusiness(businessId, query.page, query.pageSize)
        : await this.repo.listByStatus(businessId, query.status, query.page, query.pageSize);
    return {
      items: page.items.map((row) => this.toReview(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  /** The caller's own reviews (every status), newest first. */
  async listMine(
    userId: string,
    query: { page: number; pageSize: number },
  ): Promise<MyReviewsResult> {
    const page = await this.repo.listByUser(userId, query.page, query.pageSize);
    return {
      items: page.items.map((row) => this.toReview(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  async create(businessId: string, user: BusinessActor, input: CreateReviewBody): Promise<Review> {
    const business = await this.repo.findBusinessContext(businessId);
    if (!business || business.deletedAt) {
      throw notFoundException('Business', businessId);
    }
    if (business.status !== 'active') {
      throw ruleException('Only active businesses accept reviews', {
        businessId,
        status: business.status,
      });
    }
    const existing = await this.repo.findByBusinessAndUser(businessId, user.id);
    if (existing) {
      throw conflictException('You have already reviewed this business — edit it instead', {
        reviewId: existing.id,
      });
    }
    const photoMediaId = input.photoMediaId
      ? await this.validatePhoto(input.photoMediaId, user)
      : null;
    const row = await this.repo.insert({
      businessId,
      userId: user.id,
      rating: input.rating,
      body: input.body,
      photoMediaId,
    });
    this.events.emit(REVIEWS_EVENTS.created, {
      reviewId: row.id,
      businessId,
      userId: user.id,
      rating: row.rating,
    });
    return this.toReview(row);
  }

  /** Author-only edit. Unchanged fields stay; photo null clears, id replaces. */
  async update(reviewId: string, user: BusinessActor, input: UpdateReviewBody): Promise<Review> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    if (row.userId !== user.id) {
      throw forbiddenException('Only the author may edit this review');
    }
    let photoMediaId: string | null | undefined;
    if (input.photoMediaId === null) {
      photoMediaId = null; // explicit clear
    } else if (input.photoMediaId !== undefined) {
      photoMediaId = await this.validatePhoto(input.photoMediaId, user);
    }
    const updated = await this.repo.update(reviewId, {
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(photoMediaId !== undefined ? { photoMediaId } : {}),
    });
    if (!updated) throw notFoundException('Review', reviewId);
    this.events.emit(REVIEWS_EVENTS.updated, {
      reviewId,
      businessId: updated.businessId,
      userId: user.id,
      rating: updated.rating,
    });
    return this.toReview(updated);
  }

  /** Author deletes their own review; `reviews.manage` deletes any (takedown). */
  async remove(reviewId: string, user: BusinessActor): Promise<DeleteReviewResult> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    const isAuthor = row.userId === user.id;
    const isModerator = roleHasPermissions(user.role as never, [REVIEWS_MANAGE_PERMISSION]);
    if (!isAuthor && !isModerator) {
      throw forbiddenException('Only the author or a moderator may delete this review');
    }
    const ok = await this.repo.delete(reviewId);
    if (ok) {
      this.events.emit(REVIEWS_EVENTS.deleted, {
        reviewId,
        businessId: row.businessId,
        userId: user.id,
      });
    }
    return { deleted: ok };
  }

  /**
   * Aggregate recompute — the WORKER-side entry (reviews.jobs.ts) and the
   * inline test route both call this. Returns the fresh aggregate.
   */
  async recomputeRating(businessId: string): Promise<{ avgRating: string; reviewCount: number }> {
    return this.repo.recomputeRating(businessId);
  }

  // ── B4.2 votes ─────────────────────────────────────────────────────────────

  /**
   * Cast or switch the caller's helpful/unhelpful vote. Rules:
   * - the review must exist (404, never leaking);
   * - votes apply to APPROVED reviews only — pending/rejected are not
   *   publicly visible, so they cannot gather votes (422);
   * - no self-votes — a helpful score is social proof from OTHERS (422;
   *   403 is for authorization, and the caller is authorized here, just
   *   not allowed this specific action);
   * - re-voting the same value is an idempotent no-op (same response),
   *   the opposite value switches (unique index upsert), events are
   *   emitted for the spam filter (B4.5) and reputation (B4.7) prompts.
   * Vote counts are NOT denormalised anywhere — every response derives
   * them fresh from `review_votes`, so switches can never drift.
   */
  async vote(
    reviewId: string,
    user: BusinessActor,
    value: ReviewVoteValue,
  ): Promise<ReviewVoteResult> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    if (row.status !== 'approved') {
      throw ruleException('Only approved reviews accept votes', {
        reviewId,
        status: row.status,
      });
    }
    if (row.userId === user.id) {
      throw ruleException('You cannot vote on your own review', { reviewId });
    }
    const previous = await this.repo.findVoteByReviewAndUser(reviewId, user.id);
    await this.repo.upsertVote(reviewId, user.id, value);
    if (previous !== value) {
      this.events.emit(REVIEWS_EVENTS.voted, {
        reviewId,
        businessId: row.businessId,
        userId: user.id,
        value,
      });
    }
    const counts = await this.repo.countVotes(reviewId);
    return { helpful: counts.helpful, unhelpful: counts.unhelpful, myVote: value };
  }

  /**
   * Withdraw the caller's vote. Idempotent: no vote → the current counts
   * with `myVote: null` (the UI just re-syncs), no 404 — a double-tap on
   * "remove vote" must not be an error. Unknown review is still 404.
   */
  async removeVote(reviewId: string, user: BusinessActor): Promise<ReviewVoteResult> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    const removed = await this.repo.deleteVote(reviewId, user.id);
    if (removed) {
      this.events.emit(REVIEWS_EVENTS.voteRemoved, {
        reviewId,
        businessId: row.businessId,
        userId: user.id,
      });
    }
    const counts = await this.repo.countVotes(reviewId);
    return { helpful: counts.helpful, unhelpful: counts.unhelpful, myVote: null };
  }

  /**
   * Photo attach validation (same rules as the business gallery): the media
   * must exist, not be soft-deleted, be kind `review_photo`, belong to the
   * caller and be unattached — one media row lives in exactly one place.
   */
  private async validatePhoto(mediaId: string, user: BusinessActor): Promise<string> {
    const media = await this.mediaRepo.findById(mediaId);
    if (!media || media.deletedAt) throw notFoundException('Media', mediaId);
    if (media.kind !== 'review_photo') {
      throw ruleException(`Media kind ${media.kind} cannot be attached as a review photo`, {
        mediaId,
        kind: media.kind,
      });
    }
    if (media.ownerUserId !== user.id) {
      throw forbiddenException('Only the uploader may attach this media');
    }
    if (media.attachedAt) {
      throw conflictException('Media is already attached', { mediaId });
    }
    return mediaId;
  }

  /** Map a joined row to the contract shape (URL scheme from MediaUrlService). */
  private toReview(row: ReviewWithMeta): Review {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      authorName: row.authorName,
      authorUsername: row.authorUsername,
      rating: row.rating,
      body: row.body,
      status: row.status,
      photoUrl: row.photoKey ? this.mediaUrls.urlFor(row.photoKey) : null,
      helpfulCount: row.helpfulCount,
      unhelpfulCount: row.unhelpfulCount,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
