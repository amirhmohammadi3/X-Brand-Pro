import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CreateReviewBody,
  DeleteReviewReplyResult,
  DeleteReviewResult,
  MyReviewsResult,
  Review,
  ReviewListResult,
  ReviewReply,
  ReviewVoteResult,
  ReviewVoteValue,
  UpdateReviewBody,
  UpsertReviewReplyResult,
} from '@app/contracts';
import { canManageBusiness, type BusinessActor } from '../business/business-access.js';
import { MEDIA_REPOSITORY, type MediaRepositoryLike } from '../media/media.repository.js';
import { roleHasPermissions } from '../users/users.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import {
  REVIEWS_REPOSITORY,
  type ReviewReplyWithMeta,
  type ReviewWithMeta,
  type ReviewsRepositoryLike,
} from './reviews.repository.js';
import { REVIEWS_SPAM_EVALUATOR, type ReviewsSpamEvaluator } from './reviews-spam.service.js';

/** Domain events (AGENTS.md 6 — the `review.created` example lives here). Subscriber: reviews-rating.subscriber.ts (enqueue); B4.4/B4.7 add theirs. */
export const REVIEWS_EVENTS = {
  created: 'review.created',
  updated: 'review.updated',
  deleted: 'review.deleted',
  /** B4.2 — a vote was cast or switched (payload carries the new value). */
  voted: 'review.voted',
  /** B4.2 — a vote was withdrawn. */
  voteRemoved: 'review.vote.removed',
  /** B4.3 — the owner posted the FIRST reply to a review. */
  replied: 'review.replied',
  /** B4.3 — an existing reply was edited (upsert hit the conflict branch). */
  replyUpdated: 'review.reply.updated',
  /** B4.3 — a reply was removed (owner, reply author or reviews.manage). */
  replyDeleted: 'review.reply.deleted',
  /** B4.4 — the moderation queue flipped the status (aggregate must re-run). */
  statusChanged: 'review.status.changed',
  /** B4.5 — the spam filter demoted the review to pending (carries the reasons). */
  flagged: 'review.flagged',
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
    /** B4.5 — optional so the B4.1-era fakes stay 4-arg; absent = filter off. */
    @Optional() @Inject(REVIEWS_SPAM_EVALUATOR) private readonly spam?: ReviewsSpamEvaluator,
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
    // B4.5 — the automatic spam/fraud filter runs BEFORE the insert: any
    // signal (blocked word, duplicate, velocity, wave) demotes the review to
    // `pending` for the B4.4 queue instead of 422ing (the author still gets
    // a 201 and sees the pending status; nobody gets filter feedback that
    // would help evade it). Filter absent/unavailable → approved as before.
    const evaluation = this.spam
      ? await this.spam.evaluate({ user, businessId, body: input.body })
      : { flagged: false, reasons: [] };
    const row = await this.repo.insert({
      businessId,
      userId: user.id,
      rating: input.rating,
      body: input.body,
      photoMediaId,
      ...(evaluation.flagged ? { status: 'pending' as const } : {}),
    });
    this.events.emit(REVIEWS_EVENTS.created, {
      reviewId: row.id,
      businessId,
      userId: user.id,
      rating: row.rating,
    });
    if (evaluation.flagged) {
      this.events.emit(REVIEWS_EVENTS.flagged, {
        reviewId: row.id,
        businessId,
        userId: user.id,
        status: row.status,
        reasons: evaluation.reasons,
      });
    }
    // Post-insert counters (velocity/wave) — best-effort, never throws.
    void this.spam?.recordPosted(user.id, businessId);
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

  // ── B4.4 moderation ──────────────────────────────────────────────────────

  /**
   * The review moderation queue: reviews with the given status across ALL
   * businesses, OLDEST first (the reviews_status_created_idx triage order).
   * `reviews.manage` enforcement lives in the callers (ModerationController).
   * Defaults to the `pending` queue — the B4.1 pre-provisioned statuses have
   * been waiting for this prompt.
   */
  async listForModeration(
    status: 'approved' | 'pending' | 'rejected',
    page: number,
    pageSize: number,
  ): Promise<ReviewListResult> {
    const result = await this.repo.listByStatusAll(status, page, pageSize);
    return {
      items: result.items.map((row) => this.toReview(row)),
      meta: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    };
  }

  /**
   * Flip the moderation status — the decision endpoint behind
   * PATCH /moderation/reviews/:id/status (reviews.manage enforced by the
   * controller; the AUTHOR can never flip their own review — an unhappy
   * author DELETES it instead). Rules:
   * - 404 unknown review;
   * - a flip to the CURRENT status is an idempotent no-op (same response,
   *   no event, no aggregate churn — the queue double-submit is not an
   *   error); the note still updates when one is supplied;
   * - every REAL flip emits `review.status.changed` — only APPROVED rows
   *   count toward the aggregate, so the rating recompute MUST run after a
   *   pending→approved or approved→rejected move (the same jobId-deduped
   *   recompute as every other review write).
   * The moderator note is moderation-only data: stored on the row, returned
   * in THIS response, never mapped into the public Review DTO.
   */
  async moderateStatus(
    reviewId: string,
    input: { status: 'approved' | 'rejected'; note?: string },
  ): Promise<{ review: Review; moderatorNote: string | null }> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    const note = input.note ?? null;
    // Captured BEFORE the write — the flip overwrites the row's status.
    const from = row.status;
    const changed = from !== input.status;
    const updated = await this.repo.moderateStatus(reviewId, {
      status: input.status,
      moderatorNote: note,
    });
    if (!updated) throw notFoundException('Review', reviewId);
    if (changed) {
      this.events.emit(REVIEWS_EVENTS.statusChanged, {
        reviewId,
        businessId: updated.businessId,
        userId: row.userId,
        from,
        to: input.status,
      });
    }
    return { review: this.toReview(updated), moderatorNote: updated.moderatorNote };
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

  // ── B4.3 owner replies ───────────────────────────────────────────────────

  /**
   * The reply-authorization gate shared by upsert and delete. Who may speak
   * for a business: the OWNER (`businesses.owner_id` match, owner-editable
   * status — `canManageBusiness`, the same helper as every B2.x manage
   * endpoint) or a `businesses.manage` holder. A `reviews.manage` moderator
   * is deliberately NOT a replier — moderation moderates, it never speaks
   * as the business; it may only takedown via removeReply.
   */
  private async assertReplyAccess(businessId: string, user: BusinessActor): Promise<void> {
    const business = await this.repo.findBusinessContext(businessId);
    if (!business || business.deletedAt) {
      // Never leak the business behind a review id (the 404-never-leak rule).
      throw notFoundException('Business', businessId);
    }
    if (!canManageBusiness(user, { ownerId: business.ownerId, status: business.status as never })) {
      throw forbiddenException('Only the business owner may manage replies on this review');
    }
  }

  /**
   * Create or edit the ONE owner reply (upsert semantics — the unique
   * `review_replies_one_per_review` makes a second PUT an in-place edit of
   * the same row, never a thread). Rules:
   * - the review must exist (404) and be APPROVED — pending/rejected are
   *   invisible on the public page, so they cannot be answered (422);
   * - the caller must manage the review's business (403 — see
   *   assertReplyAccess);
   * - an existing reply's authorship is PROVENANCE (user_id/created_at stay
   *   the original replier's — an ownership transfer does not rewrite
   *   history); the new body + edited_at are what the edit changes.
   * Emits `review.replied` on the first reply, `review.reply.updated` on an
   * edit — hooks for the B4.5 spam filter and future notification prompts.
   */
  async upsertReply(
    reviewId: string,
    user: BusinessActor,
    input: { body: string },
  ): Promise<UpsertReviewReplyResult> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    if (row.status !== 'approved') {
      throw ruleException('Only approved reviews accept replies', {
        reviewId,
        status: row.status,
      });
    }
    await this.assertReplyAccess(row.businessId, user);
    const { row: reply, created } = await this.repo.upsertReply({
      reviewId,
      userId: user.id,
      body: input.body,
      createdAt: new Date(),
    });
    this.events.emit(created ? REVIEWS_EVENTS.replied : REVIEWS_EVENTS.replyUpdated, {
      reviewId,
      businessId: row.businessId,
      replyId: reply.id,
      userId: user.id,
    });
    return { reply: this.toReply(reply), created };
  }

  /**
   * Remove the review's reply. Allowed: the business owner/manage holder
   * (assertReplyAccess), the reply's own author (e.g. after an ownership
   * transfer they no longer manage the business but their reply is still
   * theirs) or a `reviews.manage` moderator (takedown). Idempotent when no
   * reply exists — `{ deleted: false }`, never a 404 (a double-tap on the
   * remove button must not error; the unknown REVIEW is still 404).
   */
  async removeReply(reviewId: string, user: BusinessActor): Promise<DeleteReviewReplyResult> {
    const row = await this.repo.findById(reviewId);
    if (!row) throw notFoundException('Review', reviewId);
    const reply = await this.repo.findReplyByReview(reviewId);
    if (!reply) return { deleted: false };
    const isReplyAuthor = reply.userId === user.id;
    const isModerator = roleHasPermissions(user.role as never, [REVIEWS_MANAGE_PERMISSION]);
    if (!isReplyAuthor && !isModerator) {
      await this.assertReplyAccess(row.businessId, user);
    }
    const deleted = await this.repo.deleteReply(reviewId);
    if (deleted) {
      this.events.emit(REVIEWS_EVENTS.replyDeleted, {
        reviewId,
        businessId: row.businessId,
        replyId: reply.id,
        userId: user.id,
      });
    }
    return { deleted };
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
      reply: row.replyId && row.replyBody ? this.toReplyFromJoin(row) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The reply DTO off the review row's LEFT-JOIN columns (B4.3). */
  private toReplyFromJoin(row: ReviewWithMeta): ReviewReply {
    return {
      id: row.replyId as string,
      reviewId: row.id,
      userId: row.replyUserId as string,
      authorName: row.replyAuthorName,
      body: row.replyBody as string,
      editedAt: row.replyEditedAt ? row.replyEditedAt.toISOString() : null,
      createdAt: (row.replyCreatedAt as Date).toISOString(),
      updatedAt: (row.replyUpdatedAt as Date).toISOString(),
    };
  }

  /** The reply DTO off a dedicated reply row (the upsert/remove responses). */
  private toReply(row: ReviewReplyWithMeta): ReviewReply {
    return {
      id: row.id,
      reviewId: row.reviewId,
      userId: row.userId,
      authorName: row.authorName,
      body: row.body,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
