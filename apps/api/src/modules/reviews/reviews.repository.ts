import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { mediaFiles } from '../../db/schema/media.js';
import { users } from '../../db/schema/users.js';
import { reviews, reviewReplies, reviewVotes } from '../../db/schema/reviews.js';
import type { ReviewStatus, ReviewVoteValue } from '@app/contracts';

/** DI token for the reviews repository (tests bind a fake). */
export const REVIEWS_REPOSITORY = Symbol('REVIEWS_REPOSITORY');

/** Second join over `users` for the reply author's display name (a plain
 * self-join would collide with the review-author join). */
const replyUsers = alias(users, 'reply_users');

/** Second join over `media_files` for the receipt key (B4.6 — the photo join
 * is taken; a plain self-join would collide the same way). */
const receiptMedia = alias(mediaFiles, 'receipt_media');

/** Review row joined with the photo media key + author identity (URL/name resolution in the service). */
export interface ReviewWithMeta {
  id: string;
  businessId: string;
  userId: string;
  authorName: string | null;
  authorUsername: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  photoMediaId: string | null;
  photoKey: string | null;
  /** B4.6 — receipt proof media (null when none) + its storage key. */
  receiptMediaId: string | null;
  receiptKey: string | null;
  /** B4.6 — the validated check-in triple (all null when none). The coords
   * are verification/audit data — the service never maps them into the DTO. */
  checkinAt: Date | null;
  checkinLat: number | null;
  checkinLng: number | null;
  /** B4.2 — derived per read from `review_votes` (never denormalised). */
  helpfulCount: number;
  unhelpfulCount: number;
  /** B4.3 — the owner reply, LEFT JOINed per read (null when unanswered). */
  replyId: string | null;
  replyUserId: string | null;
  replyAuthorName: string | null;
  replyBody: string | null;
  replyEditedAt: Date | null;
  replyCreatedAt: Date | null;
  replyUpdatedAt: Date | null;
  /** B4.4 — moderation-only: never mapped into the public Review DTO. */
  moderatorNote: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A reply row joined with the replier's display name. */
export interface ReviewReplyWithMeta {
  id: string;
  reviewId: string;
  userId: string;
  authorName: string | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewPage {
  items: ReviewWithMeta[];
  total: number;
}

/** The narrow fake-able surface consumed by ReviewsService + B4.1's HTTP layer. */
export interface ReviewsRepositoryLike {
  /** Existence + ownership + status of the business (404-never-leak, active-only and reply-authorization rules). `lat`/`lng` carry the business location for the B4.6 check-in validation (optional so test fakes without a location stay valid — the real column is NOT NULL). */
  findBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
    lat?: number | null;
    lng?: number | null;
  } | null>;
  /** The caller's existing review for the business (one-per-business rule). */
  findByBusinessAndUser(businessId: string, userId: string): Promise<ReviewWithMeta | null>;
  findById(reviewId: string): Promise<ReviewWithMeta | null>;
  /** Approved-only, paginated business list (public). */
  listByBusiness(businessId: string, page: number, pageSize: number): Promise<ReviewPage>;
  /** Every-status list of the caller's own reviews, newest first. */
  listByUser(userId: string, page: number, pageSize: number): Promise<ReviewPage>;
  /** Admin triage list (B4.4 builds on this): explicit status filter. */
  listByStatus(
    businessId: string,
    status: ReviewStatus,
    page: number,
    pageSize: number,
  ): Promise<ReviewPage>;
  /** The B4.4 moderation queue: reviews with the given status across ALL businesses, oldest first. */
  listByStatusAll(status: ReviewStatus, page: number, pageSize: number): Promise<ReviewPage>;
  /**
   * B4.5 duplicate detection: the user's most recent reviews (any status,
   * any business) — the service compares normalized bodies against them.
   * A user's own reviews are few; a 50-row cap bounds the scan.
   */
  findRecentByUser(
    userId: string,
    limit: number,
  ): Promise<Array<Pick<ReviewWithMeta, 'id' | 'businessId' | 'body'>>>;
  insert(input: {
    businessId: string;
    userId: string;
    rating: number;
    body: string;
    photoMediaId: string | null;
    /** B4.5 — the spam filter demotes flagged reviews to `pending`; default approved. */
    status?: ReviewStatus;
    /** B4.6 — the VALIDATED check-in triple + receipt (service-validated). */
    checkinAt?: Date | null;
    checkinLat?: number | null;
    checkinLng?: number | null;
    receiptMediaId?: string | null;
  }): Promise<ReviewWithMeta>;
  /** Author edit: rating/body/photo/receipt/check-in; stamps edited_at + updated_at. */
  update(
    reviewId: string,
    patch: {
      rating?: number;
      body?: string;
      photoMediaId?: string | null;
      receiptMediaId?: string | null;
      checkinAt?: Date | null;
      checkinLat?: number | null;
      checkinLng?: number | null;
    },
  ): Promise<ReviewWithMeta | null>;
  delete(reviewId: string): Promise<boolean>;

  // ── B4.2 votes ───────────────────────────────────────────────────────────
  /** Create or switch the caller's vote (unique (review_id, user_id) upsert). */
  upsertVote(reviewId: string, userId: string, value: ReviewVoteValue): Promise<void>;
  /** Withdraw the caller's vote; false when there was nothing to remove. */
  deleteVote(reviewId: string, userId: string): Promise<boolean>;
  /** The caller's current vote for the review, null when none. */
  findVoteByReviewAndUser(reviewId: string, userId: string): Promise<ReviewVoteValue | null>;
  /** Fresh (helpful, unhelpful) pair — one indexed scan per count. */
  countVotes(reviewId: string): Promise<{ helpful: number; unhelpful: number }>;

  // ── B4.3 replies ─────────────────────────────────────────────────────
  /** The review's reply (null when unanswered) with the replier's display name. */
  findReplyByReview(reviewId: string): Promise<ReviewReplyWithMeta | null>;
  /**
   * ONE statement: INSERT … ON CONFLICT (review_id) DO UPDATE — the first
   * call inserts (created_at = the passed timestamp), an edit rewrites body
   * + edited_at + updated_at in place (the original user_id/created_at are
   * provenance and never change). `created` is derived by comparing the
   * RETURNING created_at with the caller's insert timestamp — a conflicted
   * update keeps the ORIGINAL created_at, an insert the passed one.
   */
  upsertReply(input: {
    reviewId: string;
    userId: string;
    body: string;
    /** The service's insert-time hint — the created/updated discriminator. */
    createdAt: Date;
  }): Promise<{ row: ReviewReplyWithMeta; created: boolean }>;
  /** Remove the review's reply; false when there was none (idempotent DELETE). */
  deleteReply(reviewId: string): Promise<boolean>;
  /**
   * B4.4 — flip the moderation status (and optionally stamp the moderator
   * note) in one statement; returns the fresh row (null when gone). The
   * caller (service) decides idempotency and emits the aggregate-recompute
   * event ONLY when the status actually changed.
   */
  moderateStatus(
    reviewId: string,
    patch: { status: ReviewStatus; moderatorNote?: string | null },
  ): Promise<ReviewWithMeta | null>;
  /**
   * Recompute the business aggregate from the APPROVED reviews and write it
   * to `businesses` in ONE statement: avg rounded to 2 decimals (the
   * numeric(3,2) column), count as int; zero reviews → 0/0.
   */
  recomputeRating(businessId: string): Promise<{ avgRating: string; reviewCount: number }>;
}

const REVIEW_SELECT = {
  id: reviews.id,
  businessId: reviews.businessId,
  userId: reviews.userId,
  authorName: users.displayName,
  authorUsername: users.username,
  rating: reviews.rating,
  body: reviews.body,
  status: reviews.status,
  photoMediaId: reviews.photoMediaId,
  photoKey: mediaFiles.key,
  // B4.6: the receipt proof — key via the second media join, check-in triple
  // straight off the row (the badge derives from these in the service).
  receiptMediaId: reviews.receiptMediaId,
  receiptKey: receiptMedia.key,
  checkinAt: reviews.checkinAt,
  checkinLat: reviews.checkinLat,
  checkinLng: reviews.checkinLng,
  // B4.2: correlated counts off `review_votes_one_per_user` (review_id is the
  // leading column — an index-only scan per review). Derived per read, so a
  // vote switch or a moderation takedown can never leave a stale counter.
  helpfulCount: sql<number>`(SELECT count(*)::int FROM ${reviewVotes} WHERE ${reviewVotes.reviewId} = ${reviews.id} AND ${reviewVotes.value} = 1)`,
  unhelpfulCount: sql<number>`(SELECT count(*)::int FROM ${reviewVotes} WHERE ${reviewVotes.reviewId} = ${reviews.id} AND ${reviewVotes.value} = -1)`,
  // B4.3: the owner reply LEFT JOINed off `review_replies_one_per_review` —
  // at most one row per review, so the join cannot fan out the page.
  replyId: reviewReplies.id,
  replyUserId: reviewReplies.userId,
  replyAuthorName: replyUsers.displayName,
  replyBody: reviewReplies.body,
  replyEditedAt: reviewReplies.editedAt,
  replyCreatedAt: reviewReplies.createdAt,
  replyUpdatedAt: reviewReplies.updatedAt,
  moderatorNote: reviews.moderatorNote,
  editedAt: reviews.editedAt,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
};

/**
 * Reviews persistence (B4.1) over `reviews` (migration 0021). Joins `users`
 * for the denormalised author identity (display name falls back in the UI)
 * and `media_files` for the photo key (URL resolution stays in the service
 * via MediaUrlService). The aggregate write is a single
 * `UPDATE ... SET (SELECT AVG, COUNT ...)` result — one statement, so two
 * concurrent recomputes cannot interleave a stale count over a newer one.
 */
@Injectable()
export class ReviewsRepository implements ReviewsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
    lat: number | null;
    lng: number | null;
  } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
        // WGS84 decode of the PostGIS point for the B4.6 check-in validation
        // (geography stores (lng, lat); ST_X = longitude, ST_Y = latitude).
        lat: sql<number | null>`ST_Y(${businesses.location})::float8`,
        lng: sql<number | null>`ST_X(${businesses.location})::float8`,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The four LEFT JOINs every REVIEW_SELECT read needs (author + photo + B4.3 reply + B4.6 receipt). */
  private replyJoins() {
    return this.client.db
      .select(REVIEW_SELECT)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, reviews.photoMediaId))
      .leftJoin(receiptMedia, eq(receiptMedia.id, reviews.receiptMediaId))
      .leftJoin(reviewReplies, eq(reviewReplies.reviewId, reviews.id))
      .leftJoin(replyUsers, eq(replyUsers.id, reviewReplies.userId));
  }

  async findByBusinessAndUser(businessId: string, userId: string): Promise<ReviewWithMeta | null> {
    const rows = await this.replyJoins()
      .where(and(eq(reviews.businessId, businessId), eq(reviews.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(reviewId: string): Promise<ReviewWithMeta | null> {
    const rows = await this.replyJoins().where(eq(reviews.id, reviewId)).limit(1);
    return rows[0] ?? null;
  }

  /** Shared list builder: page slice + total count for the same WHERE. */
  private async list(where: SQL | undefined, page: number, pageSize: number): Promise<ReviewPage> {
    const items = await this.replyJoins()
      .where(where)
      .orderBy(desc(reviews.createdAt), asc(reviews.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totals = await this.client.db.select({ n: count() }).from(reviews).where(where);
    return { items, total: totals[0]?.n ?? 0 };
  }

  async listByBusiness(businessId: string, page: number, pageSize: number): Promise<ReviewPage> {
    return this.list(
      and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved')),
      page,
      pageSize,
    );
  }

  async listByStatus(
    businessId: string,
    status: ReviewStatus,
    page: number,
    pageSize: number,
  ): Promise<ReviewPage> {
    return this.list(
      and(eq(reviews.businessId, businessId), eq(reviews.status, status)),
      page,
      pageSize,
    );
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<ReviewPage> {
    return this.list(eq(reviews.userId, userId), page, pageSize);
  }

  /** B4.4 queue: one status across ALL businesses, oldest-first (triage order). */
  async listByStatusAll(status: ReviewStatus, page: number, pageSize: number): Promise<ReviewPage> {
    const items = await this.replyJoins()
      .where(eq(reviews.status, status))
      .orderBy(asc(reviews.createdAt), asc(reviews.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totals = await this.client.db
      .select({ n: count() })
      .from(reviews)
      .where(eq(reviews.status, status));
    return { items, total: totals[0]?.n ?? 0 };
  }

  async insert(input: {
    businessId: string;
    userId: string;
    rating: number;
    body: string;
    photoMediaId: string | null;
    status?: ReviewStatus;
    checkinAt?: Date | null;
    checkinLat?: number | null;
    checkinLng?: number | null;
    receiptMediaId?: string | null;
  }): Promise<ReviewWithMeta> {
    const inserted = await this.client.db
      .insert(reviews)
      .values({
        businessId: input.businessId,
        userId: input.userId,
        rating: input.rating,
        body: input.body,
        photoMediaId: input.photoMediaId,
        receiptMediaId: input.receiptMediaId ?? null,
        checkinAt: input.checkinAt ?? null,
        checkinLat: input.checkinLat ?? null,
        checkinLng: input.checkinLng ?? null,
        ...(input.status ? { status: input.status } : {}),
      })
      .returning({ id: reviews.id });
    const row = inserted[0];
    if (!row) throw new Error('reviews insert returned no rows');
    const created = await this.findById(row.id);
    if (!created) throw new Error('reviews insert vanished');
    return created;
  }

  async findRecentByUser(
    userId: string,
    limit: number,
  ): Promise<Array<Pick<ReviewWithMeta, 'id' | 'businessId' | 'body'>>> {
    return this.client.db
      .select({ id: reviews.id, businessId: reviews.businessId, body: reviews.body })
      .from(reviews)
      .where(eq(reviews.userId, userId))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit);
  }

  async update(
    reviewId: string,
    patch: {
      rating?: number;
      body?: string;
      photoMediaId?: string | null;
      receiptMediaId?: string | null;
      checkinAt?: Date | null;
      checkinLat?: number | null;
      checkinLng?: number | null;
    },
  ): Promise<ReviewWithMeta | null> {
    await this.client.db
      .update(reviews)
      .set({
        ...patch,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));
    return this.findById(reviewId);
  }

  async delete(reviewId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(reviews)
      .where(eq(reviews.id, reviewId))
      .returning({ id: reviews.id });
    return deleted.length > 0;
  }

  // ── B4.2 votes ─────────────────────────────────────────────────────────────

  /**
   * One statement: INSERT … ON CONFLICT (review_id, user_id) DO UPDATE —
   * first vote inserts, the opposite value switches in place (updated_at
   * stamped), the same value rewrites the same row (idempotent).
   */
  async upsertVote(reviewId: string, userId: string, value: ReviewVoteValue): Promise<void> {
    await this.client.db
      .insert(reviewVotes)
      .values({ reviewId, userId, value })
      .onConflictDoUpdate({
        target: [reviewVotes.reviewId, reviewVotes.userId],
        set: { value, updatedAt: new Date() },
      });
  }

  async deleteVote(reviewId: string, userId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(reviewVotes)
      .where(and(eq(reviewVotes.reviewId, reviewId), eq(reviewVotes.userId, userId)))
      .returning({ id: reviewVotes.id });
    return deleted.length > 0;
  }

  async findVoteByReviewAndUser(reviewId: string, userId: string): Promise<ReviewVoteValue | null> {
    const rows = await this.client.db
      .select({ value: reviewVotes.value })
      .from(reviewVotes)
      .where(and(eq(reviewVotes.reviewId, reviewId), eq(reviewVotes.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.value === 1 ? 1 : -1;
  }

  async countVotes(reviewId: string): Promise<{ helpful: number; unhelpful: number }> {
    const rows = await this.client.db
      .select({
        helpful: sql<number>`count(*) FILTER (WHERE ${reviewVotes.value} = 1)::int`,
        unhelpful: sql<number>`count(*) FILTER (WHERE ${reviewVotes.value} = -1)::int`,
      })
      .from(reviewVotes)
      .where(eq(reviewVotes.reviewId, reviewId));
    return rows[0] ?? { helpful: 0, unhelpful: 0 };
  }

  // ── B4.3 replies ─────────────────────────────────────────────────────────

  async findReplyByReview(reviewId: string): Promise<ReviewReplyWithMeta | null> {
    const rows = await this.client.db
      .select({
        id: reviewReplies.id,
        reviewId: reviewReplies.reviewId,
        userId: reviewReplies.userId,
        authorName: replyUsers.displayName,
        body: reviewReplies.body,
        editedAt: reviewReplies.editedAt,
        createdAt: reviewReplies.createdAt,
        updatedAt: reviewReplies.updatedAt,
      })
      .from(reviewReplies)
      .leftJoin(replyUsers, eq(replyUsers.id, reviewReplies.userId))
      .where(eq(reviewReplies.reviewId, reviewId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertReply(input: {
    reviewId: string;
    userId: string;
    body: string;
    createdAt: Date;
  }): Promise<{ row: ReviewReplyWithMeta; created: boolean }> {
    const inserted = await this.client.db
      .insert(reviewReplies)
      .values({
        reviewId: input.reviewId,
        userId: input.userId,
        body: input.body,
        // The insert hint doubles as created_at AND updated_at; a conflicted
        // edit keeps the ORIGINAL created_at (see the interface contract).
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .onConflictDoUpdate({
        target: reviewReplies.reviewId,
        set: { body: input.body, editedAt: new Date(), updatedAt: new Date() },
      })
      .returning({ createdAt: reviewReplies.createdAt });
    const returned = inserted[0];
    if (!returned) throw new Error('review_replies upsert returned no rows');
    const created = returned.createdAt.getTime() === input.createdAt.getTime();
    const row = await this.findReplyByReview(input.reviewId);
    if (!row) throw new Error('review reply vanished after upsert');
    return { row, created };
  }

  async deleteReply(reviewId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(reviewReplies)
      .where(eq(reviewReplies.reviewId, reviewId))
      .returning({ id: reviewReplies.id });
    return deleted.length > 0;
  }

  async moderateStatus(
    reviewId: string,
    patch: { status: ReviewStatus; moderatorNote?: string | null },
  ): Promise<ReviewWithMeta | null> {
    await this.client.db
      .update(reviews)
      .set({
        status: patch.status,
        ...(patch.moderatorNote !== undefined ? { moderatorNote: patch.moderatorNote } : {}),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));
    return this.findById(reviewId);
  }

  async recomputeRating(businessId: string): Promise<{ avgRating: string; reviewCount: number }> {
    const rows = await this.client.db
      .select({
        avg: sql<string>`coalesce(round(avg(${reviews.rating})::numeric, 2), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved')));
    const agg = rows[0] ?? { avg: '0', n: 0 };
    await this.client.db
      .update(businesses)
      .set({
        avgRating: agg.avg,
        reviewCount: agg.n,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));
    return { avgRating: agg.avg, reviewCount: agg.n };
  }
}
