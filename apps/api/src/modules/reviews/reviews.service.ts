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
  ReviewCheckin,
  ReviewListResult,
  ReviewReply,
  ReviewVoteResult,
  ReviewVoteValue,
  UpdateReviewBody,
  UpsertReviewReplyResult,
} from '@app/contracts';
import { REVIEW_RECEIPT_MEDIA_KIND } from '@app/contracts';
import { canManageBusiness, type BusinessActor } from '../business/business-access.js';
import { MEDIA_REPOSITORY, type MediaRepositoryLike } from '../media/media.repository.js';
import { MEDIA_SERVICE } from '../media/media.service.js';
import type { MediaService } from '../media/media.service.js';
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
import { validateCheckin } from './reviews-checkin.js';

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
  /** B4.6 — the review BECAME verified (check-in and/or receipt; fired once per flip, never on re-verification). */
  verified: 'review.verified',
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
    /** B4.6 — optional for the same reason; absent = skip the post-insert
     * markAttached (the orphan-cleanup sweep then owns the file, exactly as
     * before). Present in the real app (MediaModule is global). */
    @Optional() @Inject(MEDIA_SERVICE) private readonly mediaService?: MediaService,
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
      ? await this.validateMedia(input.photoMediaId, user, 'review_photo', 'photo')
      : null;
    // B4.6 — receipt proof: kind `verification_receipt`, same one-media-one-home rules.
    const receiptMediaId = input.receiptMediaId
      ? await this.validateMedia(input.receiptMediaId, user, REVIEW_RECEIPT_MEDIA_KIND, 'receipt')
      : null;
    // B4.6 — the check-in is validated BEFORE the insert: a failing proof
    // 422s the whole create (the caller retries without it) so the badge can
    // only ever appear on a review the server actually checked.
    const checkin = input.checkin
      ? this.resolveCheckin(input.checkin, business)
      : { checkinAt: null, checkinLat: null, checkinLng: null };
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
      receiptMediaId,
      ...checkin,
      ...(evaluation.flagged ? { status: 'pending' as const } : {}),
    });
    // B4.6 — the media rows are now referenced by the review: stamp them
    // attached (idempotent, owner-checked) so the hourly orphan sweep can
    // never delete a live photo/receipt. Best-effort — an attach failure
    // must not fail the review (claims.service precedent); the 24h window
    // and the follow-up cleanup still bound the damage.
    await this.markAttachedQuietly([photoMediaId, receiptMediaId], user.id);
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
    this.emitVerifiedIfNew(row, null, user.id);
    // Post-insert counters (velocity/wave) — best-effort, never throws.
    void this.spam?.recordPosted(user.id, businessId);
    return this.toReview(row);
  }

  /** Author-only edit. Unchanged fields stay; photo/receipt null clears, id replaces; check-in null clears, object revalidates. */
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
      photoMediaId = await this.validateMedia(input.photoMediaId, user, 'review_photo', 'photo');
    }
    // B4.6 — receipt follows the same three-state rule as the photo.
    let receiptMediaId: string | null | undefined;
    if (input.receiptMediaId === null) {
      receiptMediaId = null;
    } else if (input.receiptMediaId !== undefined) {
      receiptMediaId = await this.validateMedia(
        input.receiptMediaId,
        user,
        REVIEW_RECEIPT_MEDIA_KIND,
        'receipt',
      );
    }
    // B4.6 — check-in three-state: undefined keeps, null clears, an object
    // is revalidated against the CURRENT business location (the business may
    // have moved since create; the badge must stay truthful after any edit).
    let checkinPatch:
      | { checkinAt: Date; checkinLat: number; checkinLng: number }
      | { checkinAt: null; checkinLat: null; checkinLng: null }
      | undefined;
    if (input.checkin === null) {
      checkinPatch = { checkinAt: null, checkinLat: null, checkinLng: null };
    } else if (input.checkin !== undefined) {
      const business = await this.repo.findBusinessContext(row.businessId);
      if (!business || business.deletedAt) {
        throw notFoundException('Business', row.businessId);
      }
      checkinPatch = this.resolveCheckin(input.checkin, business);
    }
    const updated = await this.repo.update(reviewId, {
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(photoMediaId !== undefined ? { photoMediaId } : {}),
      ...(receiptMediaId !== undefined ? { receiptMediaId } : {}),
      ...(checkinPatch ?? {}),
    });
    if (!updated) throw notFoundException('Review', reviewId);
    // B4.6 — any newly attached media gets its attached stamp (see create).
    await this.markAttachedQuietly(
      [receiptMediaId, photoMediaId].map((id) => id ?? null).filter((id): id is string => !!id),
      user.id,
    );
    this.events.emit(REVIEWS_EVENTS.updated, {
      reviewId,
      businessId: updated.businessId,
      userId: user.id,
      rating: updated.rating,
    });
    this.emitVerifiedIfNew(updated, row, user.id);
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
   * Media attach validation (same rules as the business gallery): the media
   * must exist, not be soft-deleted, carry the EXPECTED kind (B4.6 — the
   * photo and the receipt are different proofs, a receipt cannot moonlight
   * as a photo), belong to the caller and be unattached — one media row
   * lives in exactly one place.
   */
  private async validateMedia(
    mediaId: string,
    user: BusinessActor,
    kind: 'review_photo' | typeof REVIEW_RECEIPT_MEDIA_KIND,
    what: string,
  ): Promise<string> {
    const media = await this.mediaRepo.findById(mediaId);
    if (!media || media.deletedAt) throw notFoundException('Media', mediaId);
    if (media.kind !== kind) {
      throw ruleException(`Media kind ${media.kind} cannot be attached as a review ${what}`, {
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

  /**
   * B4.6 — validate the claimed check-in against the business location and
   * stamp the visit time. A rejected proof 422s (with the measured distance
   * / limit in the details) — an unverified check-in is NEVER stored, so
   * `checkinAt != null` on a row always means "the server checked it".
   */
  private resolveCheckin(
    input: ReviewCheckin,
    business: { lat?: number | null; lng?: number | null },
  ): { checkinAt: Date; checkinLat: number; checkinLng: number } {
    const result = validateCheckin(input, business, new Date());
    if (!result.ok) {
      // Per-reason message + details (the measured distance / limit), so a
      // legitimate user sees WHY the proof failed — these limits are public
      // product rules, unlike the B4.5 spam internals.
      let message: string;
      let details: Record<string, unknown> = { reason: result.reason };
      switch (result.reason) {
        case 'too_far':
          message = `Check-in is ${Math.round(result.distanceM)}m from the business — the maximum is ${result.radiusM}m`;
          details = {
            ...details,
            distanceM: Math.round(result.distanceM),
            radiusM: result.radiusM,
          };
          break;
        case 'in_future':
          message = `The check-in time cannot be more than ${result.maxFutureSec}s in the future`;
          break;
        case 'too_old':
          message = `The check-in time cannot be older than ${result.maxAgeDays} days`;
          break;
        case 'no_business_location':
          message = 'The business has no location to check in against';
          break;
      }
      throw ruleException(message, details);
    }
    return {
      checkinAt: result.at,
      checkinLat: input.lat,
      checkinLng: input.lng,
    };
  }

  /**
   * B4.6 — stamp media rows attached after the review write committed
   * (idempotent, owner-checked by MediaService). Best-effort: a failure
   * must never fail the review write (claims.service precedent) — the
   * 24h orphan window bounds the damage, and absent service (B4.1-era
   * fakes) skips the call entirely.
   */
  private async markAttachedQuietly(
    mediaIds: Array<string | null>,
    ownerId: string,
  ): Promise<void> {
    const ids = mediaIds.filter((id): id is string => !!id);
    for (const id of ids) {
      await this.mediaService?.markAttached(id, ownerId).catch(() => undefined);
    }
  }

  /**
   * B4.6 — fire `review.verified` exactly when the review's badge flips
   * false → true (create-with-proof, or an edit that adds the first proof).
   * Re-verifying or swapping one proof for another is silent — the event is
   * the FIRST-time trust signal the reputation prompt (B4.7) subscribes to.
   */
  private emitVerifiedIfNew(
    row: ReviewWithMeta,
    previous: Pick<ReviewWithMeta, 'checkinAt' | 'receiptMediaId'> | null,
    userId: string,
  ): void {
    const wasVerified = previous
      ? previous.checkinAt !== null || previous.receiptMediaId !== null
      : false;
    const isVerified = row.checkinAt !== null || row.receiptMediaId !== null;
    if (!isVerified || wasVerified) return;
    const via: string[] = [];
    if (row.checkinAt !== null) via.push('checkin');
    if (row.receiptMediaId !== null) via.push('receipt');
    this.events.emit(REVIEWS_EVENTS.verified, {
      reviewId: row.id,
      businessId: row.businessId,
      userId,
      via,
    });
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
      // B4.6 — the badge derives from the proof columns per read; the raw
      // check-in coordinates NEVER leave the server (personal data).
      verified: row.checkinAt !== null || row.receiptMediaId !== null,
      checkinVerified: row.checkinAt !== null,
      checkinAt: row.checkinAt ? row.checkinAt.toISOString() : null,
      receiptUrl: row.receiptKey ? this.mediaUrls.urlFor(row.receiptKey) : null,
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
