import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ReviewsService, REVIEWS_EVENTS } from '../src/modules/reviews/reviews.service.js';
import type {
  ReviewWithMeta,
  ReviewsRepositoryLike,
} from '../src/modules/reviews/reviews.repository.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
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
    editedAt: null,
    createdAt: new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  };
}

/** In-memory repo mirroring the SQL semantics the service relies on. */
function makeRepo(
  initial: ReviewWithMeta[] = [],
  businesses?: Map<string, { status: string; deletedAt: Date | null }>,
) {
  const rows = new Map(initial.map((r) => [r.id, r]));
  const biz = businesses ?? new Map([[BIZ, { status: 'active', deletedAt: null }]]);
  let seq = 0;
  const repo = {
    async findBusinessContext(id: string) {
      return biz.get(id) ?? null;
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
    async insert(input: {
      businessId: string;
      userId: string;
      rating: number;
      body: string;
      photoMediaId: string | null;
    }) {
      const row = reviewRow({
        id: `${(seq += 1).toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
        businessId: input.businessId,
        userId: input.userId,
        rating: input.rating,
        body: input.body,
        photoMediaId: input.photoMediaId,
        // The real repo joins media_files.key; the fake derives a stable key
        // so the service's URL mapping is exercised.
        photoKey: input.photoMediaId ? `p-${input.photoMediaId.slice(0, 8)}.webp` : null,
      });
      rows.set(row.id, row);
      return row;
    },
    async update(
      id: string,
      patch: { rating?: number; body?: string; photoMediaId?: string | null },
    ) {
      const row = rows.get(id);
      if (!row) return null;
      Object.assign(row, patch, { editedAt: new Date(), updatedAt: new Date() });
      return row;
    },
    async delete(id: string) {
      return rows.delete(id);
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

function makeService(repo = makeRepo(), media = makeMedia()) {
  const events = { emit: vi.fn() };
  const svc = new ReviewsService(
    repo as ReviewsRepositoryLike,
    media,
    mediaUrls as never,
    events as never,
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
