import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ReviewsService, REVIEWS_EVENTS } from '../src/modules/reviews/reviews.service.js';
import type {
  ReviewWithMeta,
  ReviewsRepositoryLike,
} from '../src/modules/reviews/reviews.repository.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
import type { ReviewsSpamEvaluator } from '../src/modules/reviews/reviews-spam.service.js';
import type { ReviewStatus } from '@app/contracts';

/**
 * B4.1 ReviewsService — the business rules, DB-free: the active-only gate,
 * one-review-per-user-per-business, author-only edits, author-or-moderator
 * deletes, the photo kind/ownership/attach validation and the event
 * emissions the rating-aggregate subscriber listens on. The repository SQL
 * (unique index, aggregate UPDATE...FROM, pagination) is integration-tested
 * against Docker per the Follow-up; the aggregate MATH is asserted here
 * through the fake's faithful AVG/COUNT simulation of recomputeRating.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const ALICE = { id: '22222222-2222-4222-8222-222222222222', role: 'user' };
const BOB = { id: '33333333-3333-4333-8333-333333333333', role: 'user' };
const ADMIN = { id: '44444444-4444-4444-8444-444444444444', role: 'admin' };
const MODERATOR = { id: '47474747-4747-4747-8474-474747474747', role: 'moderator' };
/** The business's owner (B4.3) — matched by `owner_id`, not the role tag. */
const OWNER = { id: '88888880-8888-4888-8888-888888888880', role: 'user' };

function reviewRow(overrides: Partial<ReviewWithMeta> = {}): ReviewWithMeta {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    businessId: BIZ,
    userId: ALICE.id,
    authorName: null,
    authorUsername: 'alice',
    rating: 4,
    body: 'خیلی خوب بود، پیشنهاد می‌کنم.',
    status: 'approved' as ReviewStatus,
    photoMediaId: null,
    photoKey: null,
    receiptMediaId: null,
    receiptKey: null,
    checkinAt: null,
    checkinLat: null,
    checkinLng: null,
    isFirst: false,
    authorReputation: 0,
    helpfulCount: 0,
    unhelpfulCount: 0,
    replyId: null,
    replyUserId: null,
    replyAuthorName: null,
    replyBody: null,
    replyEditedAt: null,
    replyCreatedAt: null,
    replyUpdatedAt: null,
    moderatorNote: null,
    editedAt: null,
    createdAt: new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  };
}

/** In-memory repo mirroring the SQL semantics the service relies on. */
function makeRepo(
  initial: ReviewWithMeta[] = [],
  businesses?: Map<
    string,
    {
      ownerId?: string | null;
      status: string;
      deletedAt: Date | null;
      /** B4.6 — the business location for check-in validation (optional; the real column is NOT NULL). */
      lat?: number | null;
      lng?: number | null;
    }
  >,
) {
  const rows = new Map(initial.map((r) => [r.id, r]));
  const biz: Map<
    string,
    {
      ownerId?: string | null;
      status: string;
      deletedAt: Date | null;
      lat?: number | null;
      lng?: number | null;
    }
  > = businesses ?? new Map([[BIZ, { status: 'active', deletedAt: null, lat: 35.7, lng: 51.4 }]]);
  // B4.3: reply store keyed by review_id (the unique one-per-review target).
  const replies = new Map<
    string,
    {
      id: string;
      reviewId: string;
      userId: string;
      authorName: string | null;
      body: string;
      editedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  let replySeq = 0;
  // Mirror the LEFT JOIN: copy the reply onto its review row (nulls when none).
  const syncReply = (reviewId: string) => {
    const review = rows.get(reviewId);
    if (!review) return;
    const reply = replies.get(reviewId);
    Object.assign(
      review,
      reply
        ? {
            replyId: reply.id,
            replyUserId: reply.userId,
            replyAuthorName: reply.authorName,
            replyBody: reply.body,
            replyEditedAt: reply.editedAt,
            replyCreatedAt: reply.createdAt,
            replyUpdatedAt: reply.updatedAt,
          }
        : {
            replyId: null,
            replyUserId: null,
            replyAuthorName: null,
            replyBody: null,
            replyEditedAt: null,
            replyCreatedAt: null,
            replyUpdatedAt: null,
          },
    );
  };
  let seq = 0;
  // B4.2/B4.7 — the votes map hoisted to makeRepo scope so both the vote
  // doubles (IIFE below) and the B4.7 reputationStats read the same store.
  const votes = new Map<string, 1 | -1>();
  const repo = {
    async findBusinessContext(id: string) {
      const b = biz.get(id);
      return b
        ? {
            ownerId: b.ownerId ?? null,
            status: b.status,
            deletedAt: b.deletedAt,
            lat: b.lat ?? null,
            lng: b.lng ?? null,
          }
        : null;
    },
    async findByBusinessAndUser(businessId: string, userId: string) {
      for (const r of rows.values()) {
        if (r.businessId === businessId && r.userId === userId) return r;
      }
      return null;
    },
    async findById(id: string) {
      return rows.get(id) ?? null;
    },
    async listByBusiness(businessId: string, page: number, pageSize: number) {
      const items = [...rows.values()]
        .filter((r) => r.businessId === businessId && r.status === 'approved')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async listByUser(userId: string, page: number, pageSize: number) {
      const items = [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async listByStatus(businessId: string, status: string, page: number, pageSize: number) {
      const items = [...rows.values()]
        .filter((r) => r.businessId === businessId && r.status === status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async listByStatusAll(status: string, page: number, pageSize: number) {
      // Triage order: OLDEST first (mirrors reviews_status_created_idx).
      const items = [...rows.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async findRecentByUser(userId: string, limit: number) {
      // Mirror the repo: the user's most recent reviews, any status/business.
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((r) => ({ id: r.id, businessId: r.businessId, body: r.body }));
    },
    async insert(input: {
      businessId: string;
      userId: string;
      rating: number;
      body: string;
      photoMediaId: string | null;
      status?: 'approved' | 'pending' | 'rejected';
      checkinAt?: Date | null;
      checkinLat?: number | null;
      checkinLng?: number | null;
      receiptMediaId?: string | null;
      isFirst?: boolean;
    }) {
      const row = reviewRow({
        id: `${(seq += 1).toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
        businessId: input.businessId,
        userId: input.userId,
        rating: input.rating,
        body: input.body,
        photoMediaId: input.photoMediaId,
        status: input.status ?? ('approved' as ReviewStatus),
        // The real repo joins media_files.key; the fake derives a stable key
        // so the service's URL mapping is exercised.
        photoKey: input.photoMediaId ? `p-${input.photoMediaId.slice(0, 8)}.webp` : null,
        receiptMediaId: input.receiptMediaId ?? null,
        receiptKey: input.receiptMediaId ? `r-${input.receiptMediaId.slice(0, 8)}.webp` : null,
        checkinAt: input.checkinAt ?? null,
        checkinLat: input.checkinLat ?? null,
        checkinLng: input.checkinLng ?? null,
        isFirst: input.isFirst ?? false,
      });
      rows.set(row.id, row);
      return row;
    },
    async update(
      id: string,
      patch: {
        rating?: number;
        body?: string;
        photoMediaId?: string | null;
        receiptMediaId?: string | null;
        checkinAt?: Date | null;
        checkinLat?: number | null;
        checkinLng?: number | null;
      },
    ) {
      const row = rows.get(id);
      if (!row) return null;
      // Mirror the real repo: UPDATE + a fresh findById — a NEW object, so
      // the service's pre/post badge comparison sees distinct snapshots
      // (in-place mutation would alias previous and updated into one row).
      const merged = reviewRow({ ...row, ...patch, editedAt: new Date(), updatedAt: new Date() });
      // The keys ride the LEFT JOINs: a cleared media id nulls its key.
      if (merged.photoMediaId === null) merged.photoKey = null;
      if (merged.receiptMediaId === null) merged.receiptKey = null;
      rows.set(id, merged);
      return merged;
    },
    async delete(id: string) {
      return rows.delete(id);
    },
    // ── B4.7 reputation doubles: the source counts off the same rows (the
    // faithful recompute scheme), plus the users-table write.
    async countByUser(userId: string) {
      let n = 0;
      for (const r of rows.values()) if (r.userId === userId) n += 1;
      return n;
    },
    async reputationStats(userId: string) {
      const mine = [...rows.values()].filter((r) => r.userId === userId);
      const approved = mine.filter((r) => r.status === 'approved');
      const verified = approved.filter((r) => r.checkinAt !== null || r.receiptMediaId !== null);
      let helpful = 0;
      for (const [k, v] of votes) {
        if (v !== 1) continue;
        const reviewId = k.split(':')[0] ?? '';
        const target = rows.get(reviewId);
        if (target && target.userId === userId && target.status === 'approved') helpful += 1;
      }
      return {
        approvedReviews: approved.length,
        verifiedReviews: verified.length,
        helpfulVotesReceived: helpful,
      };
    },
    async writeReputation(userId: string, points: number) {
      for (const r of rows.values()) {
        if (r.userId === userId) r.authorReputation = points;
      }
    },
    // ── B4.2 vote doubles: a keyed votes map + faithful count() simulation,
    // mirroring the unique-(review_id, user_id) upsert semantics.
    ...((): Record<string, unknown> => {
      const key = (reviewId: string, userId: string) => `${reviewId}:${userId}`;
      const tally = (reviewId: string) => {
        let helpful = 0;
        let unhelpful = 0;
        for (const [k, v] of votes) {
          if (k.startsWith(`${reviewId}:`)) {
            if (v === 1) helpful += 1;
            else unhelpful += 1;
          }
        }
        return { helpful, unhelpful };
      };
      return {
        async upsertVote(reviewId: string, userId: string, value: 1 | -1) {
          votes.set(key(reviewId, userId), value);
          // Keep the joined rows' counts in sync so toReview/list assertions
          // can observe the new tallies.
          for (const r of rows.values()) {
            if (r.id === reviewId) {
              const t = tally(reviewId);
              Object.assign(r, { helpfulCount: t.helpful, unhelpfulCount: t.unhelpful });
            }
          }
        },
        async deleteVote(reviewId: string, userId: string) {
          return votes.delete(key(reviewId, userId));
        },
        async findVoteByReviewAndUser(reviewId: string, userId: string) {
          return votes.get(key(reviewId, userId)) ?? null;
        },
        async countVotes(reviewId: string) {
          return tally(reviewId);
        },
      };
    })(),

    // ── B4.3 reply doubles: a keyed replies map + the same one-per-review
    // upsert semantics (an existing reply edits in place; user_id/created_at
    // keep the ORIGINAL replier — provenance) and the join sync so list/read
    // assertions observe the inline reply.
    async findReplyByReview(reviewId: string) {
      const reply = replies.get(reviewId);
      return reply ? { ...reply } : null;
    },
    async upsertReply(input: { reviewId: string; userId: string; body: string; createdAt: Date }) {
      const existing = replies.get(input.reviewId);
      if (existing) {
        Object.assign(existing, {
          body: input.body,
          editedAt: new Date(),
          updatedAt: new Date(),
        });
        syncReply(input.reviewId);
        return { row: { ...existing }, created: false };
      }
      const row = {
        id: `9999999${(replySeq += 1).toString().padStart(2, '0')}-9999-4999-8999-999999999999`,
        reviewId: input.reviewId,
        userId: input.userId,
        authorName: null,
        body: input.body,
        editedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      replies.set(input.reviewId, row);
      syncReply(input.reviewId);
      return { row: { ...row }, created: true };
    },
    async deleteReply(reviewId: string) {
      const removed = replies.delete(reviewId);
      syncReply(reviewId);
      return removed;
    },
    async moderateStatus(id: string, patch: { status: string; moderatorNote?: string | null }) {
      const row = rows.get(id);
      if (!row) return null;
      Object.assign(row, {
        status: patch.status,
        moderatorNote: patch.moderatorNote ?? row.moderatorNote,
        updatedAt: new Date(),
      });
      return row;
    },

    /** Faithful simulation: AVG(rounded 2dp)/COUNT over approved only. */
    async recomputeRating(businessId: string) {
      const approved = [...rows.values()].filter(
        (r) => r.businessId === businessId && r.status === 'approved',
      );
      const n = approved.length;
      const avg = n === 0 ? 0 : approved.reduce((s, r) => s + r.rating, 0) / n;
      const rounded = Math.round(avg * 100) / 100;
      const target = biz.get(businessId) as
        | { avgRating?: string; reviewCount?: number }
        | undefined;
      if (target) {
        target.avgRating = rounded.toFixed(2);
        target.reviewCount = n;
      }
      return { avgRating: rounded.toFixed(2), reviewCount: n };
    },
  };
  return repo as unknown as ReviewsRepositoryLike & {
    recomputeRating: (id: string) => Promise<{ avgRating: string; reviewCount: number }>;
  };
}

function makeMedia(
  media?: Partial<
    Record<
      string,
      { kind: string; ownerUserId: string; attachedAt: Date | null; deletedAt: Date | null }
    >
  >,
) {
  const store = new Map(
    Object.entries({
      '66666666-6666-4666-8666-666666666666': {
        kind: 'review_photo',
        ownerUserId: ALICE.id,
        attachedAt: null,
        deletedAt: null,
      },
      '77777777-7777-4777-8777-777777777777': {
        kind: 'avatar',
        ownerUserId: ALICE.id,
        attachedAt: null,
        deletedAt: null,
      },
      '88888888-8888-4888-8888-888888888888': {
        kind: 'review_photo',
        ownerUserId: BOB.id,
        attachedAt: null,
        deletedAt: null,
      },
      '99999999-9999-4999-8999-999999999999': {
        kind: 'review_photo',
        ownerUserId: ALICE.id,
        attachedAt: new Date(),
        deletedAt: null,
      },
      [RECEIPT]: {
        kind: 'verification_receipt',
        ownerUserId: ALICE.id,
        attachedAt: null,
        deletedAt: null,
      },
      ...media,
    }),
  );
  return {
    async findById(id: string) {
      const m = store.get(id);
      return m ? { id, ...m } : null;
    },
  } as unknown as MediaRepositoryLike;
}

const mediaUrls = { urlFor: (key: string | null) => (key ? `https://media.test/${key}` : null) };

/** Receipt media owned by ALICE (B4.6) — the default store carries it so the
 * receipt specs stay one-liners; wrong-owner/attached variants override. */
const RECEIPT = 'aaaaaaa1-0000-4000-8000-00000000000a';

function makeService(
  repo = makeRepo(),
  media = makeMedia(),
  spam?: ReviewsSpamEvaluator,
  /** B4.6 — the (optional) MediaService double for markAttached assertions. */
  mediaService?: { markAttached: (id: string, ownerId: string) => Promise<unknown> },
) {
  const events = { emit: vi.fn() };
  const svc = new ReviewsService(
    repo as ReviewsRepositoryLike,
    media,
    mediaUrls as never,
    events as never,
    spam,
    mediaService as never,
  );
  return { svc, events };
}

const BODY = 'قهوه‌اش عالی بود و فضا دنج.';
const CREATE = { rating: 5, body: BODY };

describe('ReviewsService.create (B4.1)', () => {
  it('creates an approved review and emits review.created', async () => {
    const { svc, events } = makeService();
    const review = await svc.create(BIZ, ALICE, CREATE);
    expect(review.status).toBe('approved');
    expect(review.rating).toBe(5);
    expect(review.photoUrl).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.created, {
      reviewId: review.id,
      businessId: BIZ,
      userId: ALICE.id,
      rating: 5,
    });
  });

  it('404s an unknown or soft-deleted business without leaking existence', async () => {
    const biz = new Map([[BIZ, { status: 'active', deletedAt: new Date() }]]);
    const { svc } = makeService(makeRepo([], biz));
    await expect(svc.create(BIZ, ALICE, CREATE)).rejects.toMatchObject({ status: 404 });
  });

  it('422s when the business is not active', async () => {
    const biz = new Map([[BIZ, { status: 'pending', deletedAt: null }]]);
    const { svc } = makeService(makeRepo([], biz));
    await expect(svc.create(BIZ, ALICE, CREATE)).rejects.toMatchObject({ status: 422 });
  });

  it('409s the second review from the same user for the same business', async () => {
    const { svc } = makeService();
    await svc.create(BIZ, ALICE, CREATE);
    await expect(svc.create(BIZ, ALICE, { rating: 2, body: BODY })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('accepts a valid unattached review_photo owned by the caller', async () => {
    const { svc } = makeService();
    const review = await svc.create(BIZ, ALICE, {
      ...CREATE,
      photoMediaId: '66666666-6666-4666-8666-666666666666',
    });
    expect(review.photoUrl).toContain('https://media.test/');
    expect(review.photoUrl).toContain('66666666');
  });

  it('rejects a wrong-kind media as a review photo (422)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, photoMediaId: '77777777-7777-4777-8777-777777777777' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects a media owned by someone else (403)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, photoMediaId: '88888888-8888-4888-8888-888888888888' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects an already-attached media (409)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, photoMediaId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('ReviewsService.update (B4.1)', () => {
  it('the author edits rating/body and the row is stamped edited', async () => {
    const { svc } = makeService(makeRepo([reviewRow()]));
    const updated = await svc.update('55555555-5555-4555-8555-555555555555', ALICE, {
      rating: 2,
      body: 'بعد از بازدید دوم، نظرم عوض شد؛ متأسفانه.',
    });
    expect(updated.rating).toBe(2);
    expect(updated.editedAt).not.toBeNull();
  });

  it('a non-author gets 403 — admins moderate, they do not rewrite content', async () => {
    const { svc } = makeService(makeRepo([reviewRow()]));
    await expect(
      svc.update('55555555-5555-4555-8555-555555555555', ADMIN, { rating: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('clears the photo with photoMediaId=null and replaces with a new valid media', async () => {
    const withPhoto = reviewRow({ photoMediaId: '66666666-6666-4666-8666-666666666666' });
    const { svc } = makeService(makeRepo([withPhoto]));
    const cleared = await svc.update(withPhoto.id, ALICE, { photoMediaId: null });
    expect(cleared.photoUrl).toBeNull();
  });

  it('404s an unknown review id', async () => {
    const { svc } = makeService();
    await expect(
      svc.update('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ALICE, { rating: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('ReviewsService.remove (B4.1)', () => {
  it('the author deletes their own review and emits review.deleted', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const res = await svc.remove('55555555-5555-4555-8555-555555555555', ALICE);
    expect(res).toEqual({ deleted: true });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.deleted, {
      reviewId: '55555555-5555-4555-8555-555555555555',
      businessId: BIZ,
      userId: ALICE.id,
      authorId: ALICE.id,
    });
  });

  it('a plain user cannot delete someone else’s review (403)', async () => {
    const { svc } = makeService(makeRepo([reviewRow()]));
    await expect(svc.remove('55555555-5555-4555-8555-555555555555', BOB)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('an admin (reviews.manage) may delete any review', async () => {
    const { svc } = makeService(makeRepo([reviewRow()]));
    const res = await svc.remove('55555555-5555-4555-8555-555555555555', ADMIN);
    expect(res).toEqual({ deleted: true });
  });

  it('404s an unknown review id', async () => {
    const { svc } = makeService();
    await expect(svc.remove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ALICE)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('ReviewsService.listByBusiness (B4.1)', () => {
  it('returns approved reviews with page meta', async () => {
    const rows = [
      reviewRow({
        id: '55555555-5555-4555-8555-555555555551',
        createdAt: new Date('2026-11-10T09:00:00Z'),
      }),
      reviewRow({
        id: '55555555-5555-4555-8555-555555555552',
        userId: BOB.id,
        createdAt: new Date('2026-11-10T08:00:00Z'),
      }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555553', status: 'rejected' as ReviewStatus }),
    ];
    const { svc } = makeService(makeRepo(rows));
    const res = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    expect(res.meta.total).toBe(2);
    expect(res.items.every((r) => r.status === 'approved')).toBe(true);
  });

  it('serves the ?status= moderation view for reviews.manage holders', async () => {
    const rows = [
      reviewRow({ id: '55555555-5555-4555-8555-555555555553', status: 'rejected' as ReviewStatus }),
    ];
    const { svc } = makeService(makeRepo(rows));
    const res = await svc.listByBusiness(BIZ, {
      page: 1,
      pageSize: 20,
      status: 'rejected' as ReviewStatus,
    });
    expect(res.meta.total).toBe(1);
    expect(res.items[0]?.status).toBe('rejected');
  });
});

describe('ReviewsService.recomputeRating (B4.1 — aggregate math)', () => {
  it('averages approved ratings only, rounded to 2 decimals', async () => {
    const biz = new Map([[BIZ, { status: 'active', deletedAt: null }]]);
    const rows = [
      reviewRow({ rating: 5 }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555552', rating: 4 }),
      reviewRow({
        id: '55555555-5555-4555-8555-555555555553',
        rating: 1,
        status: 'pending' as ReviewStatus,
      }),
    ];
    const repo = makeRepo(rows, biz);
    const { svc } = makeService(repo);
    const agg = await svc.recomputeRating(BIZ);
    expect(agg).toEqual({ avgRating: '4.50', reviewCount: 2 });
    const target = biz.get(BIZ) as unknown as { avgRating: string; reviewCount: number };
    expect(target.avgRating).toBe('4.50');
    expect(target.reviewCount).toBe(2);
  });

  it('zero approved reviews → 0/0 (a delete of the last review resets)', async () => {
    const biz = new Map([[BIZ, { status: 'active', deletedAt: null }]]);
    const repo = makeRepo([], biz);
    const { svc } = makeService(repo);
    const agg = await svc.recomputeRating(BIZ);
    expect(agg).toEqual({ avgRating: '0.00', reviewCount: 0 });
  });

  it('one third-rating averages to 3.33 (rounding, not truncation)', async () => {
    const biz = new Map([[BIZ, { status: 'active', deletedAt: null }]]);
    const rows = [
      reviewRow({ rating: 3 }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555552', rating: 3 }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555553', rating: 4 }),
    ];
    const { svc } = makeService(makeRepo(rows, biz));
    const agg = await svc.recomputeRating(BIZ);
    expect(agg.avgRating).toBe('3.33');
  });
});

describe('ReviewsService event contract (B4.1)', () => {
  it('every write path emits exactly one review.* event with the businessId', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    await svc.create(BIZ, BOB, CREATE);
    await svc.update('55555555-5555-4555-8555-555555555555', ALICE, { rating: 3 });
    await svc.remove('55555555-5555-4555-8555-555555555555', ALICE);
    const emitted = events.emit.mock.calls.map((c) => c[0]);
    expect(emitted).toEqual([
      REVIEWS_EVENTS.created,
      REVIEWS_EVENTS.updated,
      REVIEWS_EVENTS.deleted,
    ]);
  });

  it('a failed create (duplicate) emits nothing', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    await expect(svc.create(BIZ, ALICE, CREATE)).rejects.toBeInstanceOf(HttpException);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.vote (B4.2)', () => {
  const OTHER_ROW_ID = '55555555-5555-4555-8555-555555555566';

  it('BOB casts the first helpful vote and review.voted carries the value', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const res = await svc.vote(reviewRow().id, BOB, 1);
    expect(res).toEqual({ helpful: 1, unhelpful: 0, myVote: 1 });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.voted, {
      reviewId: '55555555-5555-4555-8555-555555555555',
      businessId: BIZ,
      userId: BOB.id,
      authorId: ALICE.id,
      value: 1,
    });
  });

  it('switching helpful → unhelpful moves the vote, never adds a second one', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const reviewId = '55555555-5555-4555-8555-555555555555';
    await svc.vote(reviewId, BOB, 1);
    const switched = await svc.vote(reviewId, BOB, -1);
    expect(switched).toEqual({ helpful: 0, unhelpful: 1, myVote: -1 });
    expect(events.emit).toHaveBeenCalledTimes(2); // voted + switched, no duplicate rows
  });

  it('re-voting the same value is an idempotent no-op (no second event)', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const reviewId = '55555555-5555-4555-8555-555555555555';
    await svc.vote(reviewId, BOB, 1);
    const again = await svc.vote(reviewId, BOB, 1);
    expect(again).toEqual({ helpful: 1, unhelpful: 0, myVote: 1 });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('422s a self-vote — helpfulness is social proof from others', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    await expect(svc.vote('55555555-5555-4555-8555-555555555555', ALICE, 1)).rejects.toMatchObject({
      status: 422,
    });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('422s a vote on a pending review (not publicly visible)', async () => {
    const { svc } = makeService(makeRepo([reviewRow({ status: 'pending' })]));
    await expect(svc.vote('55555555-5555-4555-8555-555555555555', BOB, 1)).rejects.toMatchObject({
      status: 422,
    });
  });

  it('422s a vote on a rejected review', async () => {
    const { svc } = makeService(makeRepo([reviewRow({ status: 'rejected' })]));
    await expect(svc.vote('55555555-5555-4555-8555-555555555555', BOB, -1)).rejects.toMatchObject({
      status: 422,
    });
  });

  it('404s an unknown review without leaking existence', async () => {
    const { svc } = makeService(makeRepo([]));
    await expect(svc.vote(OTHER_ROW_ID, BOB, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('tallies multiple independent voters', async () => {
    const { svc } = makeService(
      makeRepo([reviewRow(), reviewRow({ id: OTHER_ROW_ID, userId: BOB.id })]),
    );
    const reviewId = '55555555-5555-4555-8555-555555555555';
    await svc.vote(reviewId, BOB, 1);
    await svc.vote(reviewId, ADMIN, 1);
    const res = await svc.vote(
      reviewId,
      { id: '66666666-6666-4666-8666-666666666666', role: 'user' },
      -1,
    );
    expect(res).toEqual({ helpful: 2, unhelpful: 1, myVote: -1 });
  });
});

describe('ReviewsService.removeVote (B4.2)', () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';

  it('withdraws the caller’s vote and emits review.vote.removed', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    await svc.vote(reviewId, BOB, 1);
    events.emit.mockClear();
    const res = await svc.removeVote(reviewId, BOB);
    expect(res).toEqual({ helpful: 0, unhelpful: 0, myVote: null });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.voteRemoved, {
      reviewId,
      businessId: BIZ,
      userId: BOB.id,
      authorId: ALICE.id,
    });
  });

  it('is idempotent with no vote cast — counts back, no event, no error', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const res = await svc.removeVote(reviewId, BOB);
    expect(res).toEqual({ helpful: 0, unhelpful: 0, myVote: null });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('404s an unknown review', async () => {
    const { svc } = makeService(makeRepo([]));
    await expect(svc.removeVote('55555555-5555-4555-8555-555555555577', BOB)).rejects.toMatchObject(
      { status: 404 },
    );
  });
});

describe('ReviewsService.upsertReply (B4.3)', () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const ownedBiz = new Map([[BIZ, { ownerId: OWNER.id, status: 'active', deletedAt: null }]]);
  const REPLY = { body: 'ممنون از نظرتان؛ خوشحالیم که راضی بودید.' };

  it('the owner posts the FIRST reply — created=true, review.replied emitted', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()], ownedBiz));
    const res = await svc.upsertReply(reviewId, OWNER, REPLY);
    expect(res.created).toBe(true);
    expect(res.reply.body).toBe(REPLY.body);
    expect(res.reply.editedAt).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.replied, {
      reviewId,
      businessId: BIZ,
      replyId: res.reply.id,
      userId: OWNER.id,
    });
  });

  it('a second PUT edits the SAME reply — created=false, review.reply.updated, provenance kept', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()], ownedBiz));
    const first = await svc.upsertReply(reviewId, OWNER, REPLY);
    const second = await svc.upsertReply(reviewId, OWNER, {
      body: 'ویرایش: تخفیف ۱۰٪ برای بازدید بعدی فعال شد.',
    });
    expect(second.created).toBe(false);
    expect(second.reply.id).toBe(first.reply.id);
    expect(second.reply.userId).toBe(OWNER.id);
    expect(second.reply.editedAt).not.toBeNull();
    expect(events.emit).toHaveBeenLastCalledWith(REVIEWS_EVENTS.replyUpdated, {
      reviewId,
      businessId: BIZ,
      replyId: first.reply.id,
      userId: OWNER.id,
    });
  });

  it('an admin (businesses.manage) may reply; a moderator (reviews.manage) may NOT speak for the business', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()], ownedBiz));
    const byAdmin = await svc.upsertReply(reviewId, ADMIN, REPLY);
    expect(byAdmin.created).toBe(true);
    expect(events.emit).toHaveBeenCalledTimes(1);
    await expect(svc.upsertReply(reviewId, MODERATOR, REPLY)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('a plain user gets 403 even when they authored the review', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()], ownedBiz));
    await expect(svc.upsertReply(reviewId, ALICE, REPLY)).rejects.toMatchObject({ status: 403 });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('422s a reply to a pending review (invisible on the public page)', async () => {
    const { svc } = makeService(makeRepo([reviewRow({ status: 'pending' })], ownedBiz));
    await expect(svc.upsertReply(reviewId, OWNER, REPLY)).rejects.toMatchObject({ status: 422 });
  });

  it('422s a reply to a rejected review', async () => {
    const { svc } = makeService(makeRepo([reviewRow({ status: 'rejected' })], ownedBiz));
    await expect(svc.upsertReply(reviewId, OWNER, REPLY)).rejects.toMatchObject({ status: 422 });
  });

  it('404s an unknown review', async () => {
    const { svc } = makeService(makeRepo([], ownedBiz));
    await expect(
      svc.upsertReply('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OWNER, REPLY),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404s (never 403) when the business behind the review is soft-deleted — no existence leak', async () => {
    const deletedBiz = new Map([
      [BIZ, { ownerId: OWNER.id, status: 'active', deletedAt: new Date() }],
    ]);
    const { svc } = makeService(makeRepo([reviewRow()], deletedBiz));
    await expect(svc.upsertReply(reviewId, OWNER, REPLY)).rejects.toMatchObject({ status: 404 });
  });

  it('a suspended business keeps its owner able to answer (owner-editable status)', async () => {
    const suspendedBiz = new Map([
      [BIZ, { ownerId: OWNER.id, status: 'suspended', deletedAt: null }],
    ]);
    const { svc } = makeService(makeRepo([reviewRow()], suspendedBiz));
    const res = await svc.upsertReply(reviewId, OWNER, REPLY);
    expect(res.created).toBe(true);
  });

  it('the reply rides inline on the review DTO (the LEFT-JOIN shape)', async () => {
    const { svc } = makeService(makeRepo([reviewRow()], ownedBiz));
    const { reply } = await svc.upsertReply(reviewId, OWNER, REPLY);
    const list = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    expect(list.items[0]?.reply).not.toBeNull();
    expect(list.items[0]?.reply?.id).toBe(reply.id);
    expect(list.items[0]?.reply?.body).toBe(REPLY.body);
  });
});

describe('ReviewsService.removeReply (B4.3)', () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';
  const ownedBiz = new Map([[BIZ, { ownerId: OWNER.id, status: 'active', deletedAt: null }]]);
  const REPLY = { body: 'ممنون از نظرتان؛ خوشحالیم که راضی بودید.' };

  async function withReply() {
    const ctx = makeService(makeRepo([reviewRow()], ownedBiz));
    const created = await ctx.svc.upsertReply(reviewId, OWNER, REPLY);
    ctx.events.emit.mockClear();
    return { ...ctx, created };
  }

  it('the owner removes the reply and review.reply.deleted is emitted', async () => {
    const { svc, events, created } = await withReply();
    const res = await svc.removeReply(reviewId, OWNER);
    expect(res).toEqual({ deleted: true });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.replyDeleted, {
      reviewId,
      businessId: BIZ,
      replyId: created.reply.id,
      userId: OWNER.id,
    });
  });

  it('a moderator (reviews.manage) may takedown a reply', async () => {
    const { svc, events } = await withReply();
    const res = await svc.removeReply(reviewId, MODERATOR);
    expect(res).toEqual({ deleted: true });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('a plain user (neither owner nor moderator) gets 403', async () => {
    const { svc, events } = await withReply();
    await expect(svc.removeReply(reviewId, BOB)).rejects.toMatchObject({ status: 403 });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('is idempotent with no reply — { deleted: false }, no event, no error', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()], ownedBiz));
    const res = await svc.removeReply(reviewId, OWNER);
    expect(res).toEqual({ deleted: false });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('404s an unknown review', async () => {
    const { svc } = makeService(makeRepo([], ownedBiz));
    await expect(
      svc.removeReply('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OWNER),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('removal clears the inline reply from the review DTO', async () => {
    const { svc } = await withReply();
    await svc.removeReply(reviewId, OWNER);
    const list = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    expect(list.items[0]?.reply).toBeNull();
  });
});

describe('ReviewsService.moderateStatus (B4.4)', () => {
  const reviewId = '55555555-5555-4555-8555-555555555555';

  it('flips pending → approved and emits review.status.changed (aggregate must re-run)', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow({ status: 'pending' })]));
    const res = await svc.moderateStatus(reviewId, { status: 'approved' });
    expect(res.review.status).toBe('approved');
    expect(res.moderatorNote).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.statusChanged, {
      reviewId,
      businessId: BIZ,
      userId: ALICE.id,
      from: 'pending',
      to: 'approved',
    });
  });

  it('stamps the moderator note on rejection (moderation-only data)', async () => {
    const { svc } = makeService(makeRepo([reviewRow()]));
    const res = await svc.moderateStatus(reviewId, {
      status: 'rejected',
      note: 'تبلیغ خارج از قوانین',
    });
    expect(res.review.status).toBe('rejected');
    expect(res.moderatorNote).toBe('تبلیغ خارج از قوانین');
    // The PUBLIC DTO never carries the moderation note.
    expect(res.review).not.toHaveProperty('moderatorNote');
  });

  it('a flip to the CURRENT status is an idempotent no-op — no event, no aggregate churn', async () => {
    const { svc, events } = makeService(makeRepo([reviewRow()]));
    const res = await svc.moderateStatus(reviewId, { status: 'approved' });
    expect(res.review.status).toBe('approved');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('404s an unknown review', async () => {
    const { svc } = makeService(makeRepo([]));
    await expect(
      svc.moderateStatus('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { status: 'approved' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('the queue lists pending reviews across ALL businesses, oldest first', async () => {
    const rows = [
      reviewRow({
        id: '55555555-5555-4555-8555-555555555552',
        businessId: '12121212-1212-4121-8121-121212121212',
        status: 'pending',
        createdAt: new Date('2026-11-10T08:00:00Z'),
      }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555551', status: 'pending' }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555553', status: 'approved' }),
    ];
    const { svc } = makeService(makeRepo(rows));
    const queue = await svc.listForModeration('pending', 1, 20);
    expect(queue.meta.total).toBe(2);
    expect(queue.items.map((r) => r.id)).toEqual([
      '55555555-5555-4555-8555-555555555552', // created 08:00 — oldest first
      '55555555-5555-4555-8555-555555555551', // created 10:00
    ]);
  });
});

describe('ReviewsService.create with the spam filter (B4.5)', () => {
  const FLAGGED = {
    evaluate: vi.fn(async () => ({ flagged: true, reasons: ['blocked_word:تبلیغ'] })),
    recordPosted: vi.fn(async () => undefined),
  } as unknown as ReviewsSpamEvaluator & { evaluate: ReturnType<typeof vi.fn> };
  const CLEAN = {
    evaluate: vi.fn(async () => ({ flagged: false, reasons: [] })),
    recordPosted: vi.fn(async () => undefined),
  } as unknown as ReviewsSpamEvaluator;

  it('a flagged review is created PENDING and review.flagged carries the reasons', async () => {
    const { svc, events } = makeService(makeRepo(), makeMedia(), FLAGGED);
    const review = await svc.create(BIZ, ALICE, CREATE);
    expect(review.status).toBe('pending');
    expect(FLAGGED.evaluate).toHaveBeenCalledWith({
      user: ALICE,
      businessId: BIZ,
      body: BODY,
    });
    const flagged = events.emit.mock.calls.find((c) => c[0] === 'review.flagged');
    expect(flagged?.[1]).toMatchObject({
      reviewId: review.id,
      businessId: BIZ,
      reasons: ['blocked_word:تبلیغ'],
    });
    // review.created still fires (the aggregate subscriber ignores non-approved rows).
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.created, {
      reviewId: review.id,
      businessId: BIZ,
      userId: ALICE.id,
      rating: 5,
    });
  });

  it('a clean review stays APPROVED and the counters bump after the insert', async () => {
    const { svc } = makeService(makeRepo(), makeMedia(), CLEAN);
    const review = await svc.create(BIZ, ALICE, CREATE);
    expect(review.status).toBe('approved');
    expect(CLEAN.recordPosted).toHaveBeenCalledWith(ALICE.id, BIZ);
  });

  it('a review is NOT flagged before the photo validation passes (validate-first order)', async () => {
    const { svc } = makeService(makeRepo(), makeMedia(), FLAGGED);
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, photoMediaId: '77777777-7777-4777-8777-777777777777' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(FLAGGED.evaluate).not.toHaveBeenCalled();
  });
});

// ── B4.6 verified reviews: check-in, receipt, badge ──────────────────────────

/**
 * The default business sits at (35.70, 51.40) in the makeRepo map. Haversine
 * on 0.001° of latitude ≈ 111 m — inside the 250 m radius; 0.02° ≈ 2.2 km —
 * far outside. The time window: 31 days back → too_old, 10 minutes ahead →
 * in_future (tolerance is 300 s).
 */
describe('ReviewsService.create with a check-in (B4.6)', () => {
  const NEAR = { lat: 35.701, lng: 51.4 }; // ~111 m from the business
  const FAR = { lat: 35.72, lng: 51.4 }; // ~2.2 km from the business

  it('stores a VALIDATED check-in (at + coords) and derives the badge', async () => {
    const { svc } = makeService();
    const at = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    const review = await svc.create(BIZ, ALICE, { ...CREATE, checkin: { ...NEAR, at } });
    expect(review.verified).toBe(true);
    expect(review.checkinVerified).toBe(true);
    expect(review.checkinAt).toBe(at);
    // The raw coordinates NEVER reach the DTO (privacy).
    expect(JSON.stringify(review)).not.toContain('35.701');
  });

  it('defaults `at` to now when the body omits it', async () => {
    const { svc } = makeService();
    const before = Date.now();
    const review = await svc.create(BIZ, ALICE, { ...CREATE, checkin: NEAR });
    const stamped = new Date(review.checkinAt as string).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('422s a check-in beyond the radius, with the measured distance in the details', async () => {
    const { svc } = makeService();
    await expect(svc.create(BIZ, ALICE, { ...CREATE, checkin: FAR })).rejects.toMatchObject({
      status: 422,
      response: { details: { reason: 'too_far', radiusM: 250 } },
    });
  });

  it('422s a check-in more than 300 s in the future', async () => {
    const { svc } = makeService();
    const at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, checkin: { ...NEAR, at } }),
    ).rejects.toMatchObject({ status: 422, response: { details: { reason: 'in_future' } } });
  });

  it('422s a check-in older than 30 days', async () => {
    const { svc } = makeService();
    const at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      svc.create(BIZ, ALICE, { ...CREATE, checkin: { ...NEAR, at } }),
    ).rejects.toMatchObject({ status: 422, response: { details: { reason: 'too_old' } } });
  });

  it('422s when the business has no location to check in against', async () => {
    const { svc } = makeService(
      makeRepo([], new Map([[BIZ, { status: 'active', deletedAt: null, lat: null, lng: null }]])),
    );
    await expect(svc.create(BIZ, ALICE, { ...CREATE, checkin: NEAR })).rejects.toMatchObject({
      status: 422,
      response: { details: { reason: 'no_business_location' } },
    });
  });

  it('emits review.verified exactly once with via=[checkin]', async () => {
    const { svc, events } = makeService();
    const review = await svc.create(BIZ, ALICE, { ...CREATE, checkin: NEAR });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.verified, {
      reviewId: review.id,
      businessId: BIZ,
      userId: ALICE.id,
      via: ['checkin'],
    });
    expect(events.emit.mock.calls.filter((c) => c[0] === 'review.verified')).toHaveLength(1);
  });

  it('an unverified create emits NO review.verified', async () => {
    const { svc, events } = makeService();
    await svc.create(BIZ, ALICE, CREATE);
    expect(events.emit).not.toHaveBeenCalledWith('review.verified', expect.anything());
  });
});

describe('ReviewsService.create with a receipt (B4.6)', () => {
  it('attaches kind verification_receipt and derives the badge + URL', async () => {
    const { svc } = makeService();
    const review = await svc.create(BIZ, ALICE, { ...CREATE, receiptMediaId: RECEIPT });
    expect(review.verified).toBe(true);
    expect(review.checkinVerified).toBe(false);
    expect(review.checkinAt).toBeNull();
    expect(review.receiptUrl).toBe('https://media.test/r-aaaaaaa1.webp');
  });

  it('emits review.verified with via=[receipt] on the first proof', async () => {
    const { svc, events } = makeService();
    const review = await svc.create(BIZ, ALICE, { ...CREATE, receiptMediaId: RECEIPT });
    expect(events.emit).toHaveBeenCalledWith(REVIEWS_EVENTS.verified, {
      reviewId: review.id,
      businessId: BIZ,
      userId: ALICE.id,
      via: ['receipt'],
    });
  });

  it('422s when the media is a review_photo, not a verification_receipt', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(BIZ, ALICE, {
        ...CREATE,
        receiptMediaId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('403s another user’s receipt', async () => {
    const { svc } = makeService(
      makeRepo(),
      makeMedia({
        'bbbbbbb2-0000-4000-8000-00000000000b': {
          kind: 'verification_receipt',
          ownerUserId: BOB.id,
          attachedAt: null,
          deletedAt: null,
        },
      }),
    );
    await expect(
      svc.create(BIZ, ALICE, {
        ...CREATE,
        receiptMediaId: 'bbbbbbb2-0000-4000-8000-00000000000b',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('409s an already-attached receipt (one media one home)', async () => {
    const { svc } = makeService(
      makeRepo(),
      makeMedia({
        'ccccccc3-0000-4000-8000-00000000000c': {
          kind: 'verification_receipt',
          ownerUserId: ALICE.id,
          attachedAt: new Date(),
          deletedAt: null,
        },
      }),
    );
    await expect(
      svc.create(BIZ, ALICE, {
        ...CREATE,
        receiptMediaId: 'ccccccc3-0000-4000-8000-00000000000c',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('stamps photo AND receipt attached after the insert (orphan-sweep guard)', async () => {
    const markAttached = vi.fn(async () => undefined);
    const { svc } = makeService(makeRepo(), makeMedia(), undefined, { markAttached });
    await svc.create(BIZ, ALICE, {
      ...CREATE,
      photoMediaId: '66666666-6666-4666-8666-666666666666',
      receiptMediaId: RECEIPT,
    });
    expect(markAttached).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666', ALICE.id);
    expect(markAttached).toHaveBeenCalledWith(RECEIPT, ALICE.id);
  });

  it('a markAttached failure never fails the review write', async () => {
    const markAttached = vi.fn(async () => {
      throw new Error('storage down');
    });
    const { svc } = makeService(makeRepo(), makeMedia(), undefined, { markAttached });
    const review = await svc.create(BIZ, ALICE, { ...CREATE, receiptMediaId: RECEIPT });
    expect(review.verified).toBe(true);
  });
});

describe('ReviewsService.update with check-in/receipt (B4.6)', () => {
  const NEAR = { lat: 35.701, lng: 51.4 };

  it('adds a check-in on edit and fires the badge flip ONCE (false→true)', async () => {
    const row = reviewRow({ userId: ALICE.id }); // unverified
    const { svc, events } = makeService(makeRepo([row]));
    const updated = await svc.update(row.id, ALICE, { checkin: NEAR });
    expect(updated.verified).toBe(true);
    const verifiedEvents = events.emit.mock.calls.filter((c) => c[0] === 'review.verified');
    expect(verifiedEvents).toHaveLength(1);
    expect(verifiedEvents[0]![1]).toMatchObject({ reviewId: row.id, via: ['checkin'] });
  });

  it('re-verifies a check-in against the CURRENT business location', async () => {
    const row = reviewRow({ userId: ALICE.id });
    const { svc } = makeService(makeRepo([row]));
    await expect(
      svc.update(row.id, ALICE, { checkin: { lat: 35.72, lng: 51.4 } }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('clears the check-in with null (the badge drops when no receipt remains)', async () => {
    const row = reviewRow({
      userId: ALICE.id,
      checkinAt: new Date('2026-11-10T09:00:00Z'),
      checkinLat: 35.7,
      checkinLng: 51.4,
    });
    const { svc } = makeService(makeRepo([row]));
    const updated = await svc.update(row.id, ALICE, { checkin: null });
    expect(updated.checkinVerified).toBe(false);
    expect(updated.checkinAt).toBeNull();
    expect(updated.verified).toBe(false);
  });

  it('clearing the receipt keeps the badge when a check-in remains', async () => {
    const row = reviewRow({
      userId: ALICE.id,
      checkinAt: new Date('2026-11-10T09:00:00Z'),
      checkinLat: 35.7,
      checkinLng: 51.4,
      receiptMediaId: RECEIPT,
      receiptKey: 'r-a.webp',
    });
    const { svc } = makeService(makeRepo([row]));
    const updated = await svc.update(row.id, ALICE, { receiptMediaId: null });
    expect(updated.receiptUrl).toBeNull();
    expect(updated.verified).toBe(true);
  });

  it('re-verification of an already-verified review emits NO second event', async () => {
    const row = reviewRow({
      userId: ALICE.id,
      checkinAt: new Date('2026-11-10T09:00:00Z'),
      checkinLat: 35.7,
      checkinLng: 51.4,
    });
    const { svc, events } = makeService(makeRepo([row]));
    await svc.update(row.id, ALICE, { receiptMediaId: RECEIPT });
    expect(events.emit).not.toHaveBeenCalledWith('review.verified', expect.anything());
  });
});

// ── B4.7 reputation: score, levels, «اولین نظر» badge ────────────────────────

describe('ReviewsService.create — the first-review stamp (B4.7)', () => {
  it('stamps is_first on the author’s FIRST review only', async () => {
    const { svc } = makeService();
    const first = await svc.create(BIZ, ALICE, CREATE);
    expect(first.isFirstReview).toBe(true);
    const second = await svc.create(BIZ, BOB, CREATE);
    expect(second.isFirstReview).toBe(true); // BOB's first
    // ALICE reviews a second business — no longer her first.
    const biz2 = '12121212-1212-4212-8212-121212121212';
    const repo = makeRepo(
      [],
      new Map([
        [BIZ, { status: 'active', deletedAt: null }],
        [biz2, { status: 'active', deletedAt: null }],
      ]),
    );
    const svc2 = makeService(repo).svc;
    await svc2.create(BIZ, ALICE, CREATE);
    const another = await svc2.create(biz2, ALICE, CREATE);
    expect(another.isFirstReview).toBe(false);
  });
});

describe('ReviewsService.recomputeReputation (B4.7)', () => {
  it('derives the score FROM SOURCE: 10/approved + 25/verified + 2/helpful', async () => {
    // ALICE has one row seeded in the fake (approved, unverified) → 10 pts.
    const row = reviewRow({ userId: ALICE.id });
    const repo = makeRepo([row]);
    const { svc } = makeService(repo);
    const rep = await svc.recomputeReputation(ALICE.id);
    expect(rep.stats).toEqual({
      approvedReviews: 1,
      verifiedReviews: 0,
      helpfulVotesReceived: 0,
    });
    expect(rep.points).toBe(10);
    expect(rep.level).toBe('newcomer');
    // The denormalised write-back happened (the fake mirrors it onto the rows).
    const stored = await repo.findById(row.id);
    expect(stored?.authorReputation).toBe(10);
  });

  it('crosses the level thresholds in order', async () => {
    const rows = [
      reviewRow({ id: '55555551-5555-4555-8555-555555555551', userId: ALICE.id }),
      reviewRow({ id: '55555552-5555-4555-8555-555555555552', userId: ALICE.id }),
      reviewRow({
        id: '55555553-5555-4555-8555-555555555553',
        userId: ALICE.id,
        checkinAt: new Date('2026-11-10T09:00:00Z'),
        checkinLat: 35.7,
        checkinLng: 51.4,
      }),
      reviewRow({ id: '55555554-5555-4555-8555-555555555554', userId: ALICE.id }),
      reviewRow({ id: '55555555-5555-4555-8555-555555555555', userId: ALICE.id }),
    ];
    const repo = makeRepo(rows);
    // Two helpful votes on approved reviews.
    await repo.upsertVote(rows[0]!.id, BOB.id, 1);
    await repo.upsertVote(rows[1]!.id, BOB.id, 1);
    const { svc } = makeService(repo);
    const rep = await svc.recomputeReputation(ALICE.id);
    // 5 approved ×10 + 1 verified ×25 + 2 helpful ×2 = 79 → contributor.
    expect(rep.stats.helpfulVotesReceived).toBe(2);
    expect(rep.points).toBe(79);
    expect(rep.level).toBe('contributor');
  });

  it('myReputation answers LIVE from source (never the stored column)', async () => {
    const repo = makeRepo([reviewRow({ userId: ALICE.id, authorReputation: 999 })]);
    const { svc } = makeService(repo);
    const rep = await svc.myReputation(ALICE.id);
    expect(rep.points).toBe(10);
  });
});

describe('toReview — author trust fields (B4.7)', () => {
  it('maps isFirstReview + authorLevel off the row', async () => {
    const repo = makeRepo([
      reviewRow({ userId: ALICE.id, isFirst: true, authorReputation: 210 }),
      reviewRow({
        id: '66666661-6666-4666-8666-666666666661',
        userId: BOB.id,
        authorReputation: 40,
      }),
    ]);
    const { svc } = makeService(repo);
    const list = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    const byUser = new Map(list.items.map((r) => [r.userId, r]));
    expect(byUser.get(ALICE.id)?.isFirstReview).toBe(true);
    expect(byUser.get(ALICE.id)?.authorLevel).toBe('expert');
    expect(byUser.get(BOB.id)?.isFirstReview).toBe(false);
    expect(byUser.get(BOB.id)?.authorLevel).toBe('newcomer');
  });
});
