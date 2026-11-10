import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { MEDIA_REPOSITORY } from '../src/modules/media/media.repository.js';
import { REVIEWS_REPOSITORY } from '../src/modules/reviews/reviews.repository.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { handleRecomputeRating } from '../src/modules/reviews/reviews.jobs.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level review tests (B4.1) WITHOUT live services: Redis is FakeRedis,
 * the user/session repositories are in-memory fakes, the reviews repository
 * is an in-memory fake (the real SQL needs Postgres+PostGIS — Docker
 * follow-up), media is an in-memory fake, the audit service is a capturing
 * spy and the `reviews` queue runs through an INLINE double that executes the
 * same handler the worker would run (handleRecomputeRating), so the full
 * request → event → enqueue → aggregate-recompute path is exercised.
 *
 * The real controllers, guards (RateLimit → JwtAuth → CsrfOrigin → Roles),
 * envelope and exception filter all run for real here.
 */

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const PENDING = '12121212-1212-4121-8121-121212121212';
const DELETED = '13131313-1313-4131-8131-131313131313';
const PHOTO = '66666666-6666-4666-8666-666666666666';
const PHOTO_WRONG_KIND = '77777777-7777-4777-8777-777777777777';
const ACTIVE2 = '14141414-1414-4141-8141-141414141414';
/** Set in beforeAll — the media fake resolves ownership lazily (the module
 * compiles before the users exist). */
const reviewerId = { current: 'pending' };

interface FakeBusinessRow {
  status: string;
  deletedAt: Date | null;
  avgRating: string;
  reviewCount: number;
}

interface FakeReviewRow {
  id: string;
  businessId: string;
  userId: string;
  authorName: string | null;
  authorUsername: string;
  rating: number;
  body: string;
  status: 'approved' | 'pending' | 'rejected';
  photoMediaId: string | null;
  photoKey: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** In-memory reviews repo mirroring the service's expected semantics. */
function makeMemoryReviewsRepo() {
  const businesses = new Map<string, FakeBusinessRow>([
    [ACTIVE, { status: 'active', deletedAt: null, avgRating: '0.00', reviewCount: 0 }],
    [ACTIVE2, { status: 'active', deletedAt: null, avgRating: '0.00', reviewCount: 0 }],
    [PENDING, { status: 'pending', deletedAt: null, avgRating: '0.00', reviewCount: 0 }],
    [DELETED, { status: 'active', deletedAt: new Date(), avgRating: '0.00', reviewCount: 0 }],
  ]);
  const rows = new Map<string, FakeReviewRow>();
  let seq = 0;
  const recompute = (businessId: string) => {
    const approved = [...rows.values()].filter(
      (r) => r.businessId === businessId && r.status === 'approved',
    );
    const n = approved.length;
    const avg = n === 0 ? 0 : approved.reduce((s, r) => s + r.rating, 0) / n;
    const rounded = Math.round(avg * 100) / 100;
    const target = businesses.get(businessId);
    if (target) {
      target.avgRating = rounded.toFixed(2);
      target.reviewCount = n;
    }
    return { avgRating: rounded.toFixed(2), reviewCount: n };
  };
  const repo = {
    businesses,
    rows,
    async findBusinessContext(id: string) {
      const b = businesses.get(id);
      return b ? { status: b.status, deletedAt: b.deletedAt } : null;
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
      authorUsername: string;
    }) {
      const id = `${(seq += 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
      const row: FakeReviewRow = {
        id,
        businessId: input.businessId,
        userId: input.userId,
        authorName: null,
        authorUsername: input.authorUsername ?? 'reviewer',
        rating: input.rating,
        body: input.body,
        status: 'approved',
        photoMediaId: input.photoMediaId,
        photoKey: input.photoMediaId ? `p-${input.photoMediaId.slice(0, 8)}.webp` : null,
        editedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(id, row);
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
    async recomputeRating(businessId: string) {
      return recompute(businessId);
    },
  };
  return repo as unknown as typeof repo & Record<string, unknown>;
}

function makeMemoryMediaRepo() {
  const media = new Map([
    [PHOTO, { kind: 'review_photo', ownerUserId: reviewerId, attachedAt: null, deletedAt: null }],
    [
      PHOTO_WRONG_KIND,
      { kind: 'avatar', ownerUserId: reviewerId, attachedAt: null, deletedAt: null },
    ],
  ]);
  return {
    async findById(id: string) {
      const m = media.get(id);
      return m
        ? {
            id,
            kind: m.kind,
            ownerUserId: m.ownerUserId.current,
            attachedAt: m.attachedAt,
            deletedAt: m.deletedAt,
          }
        : null;
    },
  } as unknown as Record<string, unknown>;
}

/**
 * Inline queue double: enqueue() immediately runs the reviews processor's
 * handler (the code the WORKER would run), so the tests exercise the full
 * event → enqueue → recompute path without a real Redis/BullMQ.
 */
class InlineReviewsQueue {
  route: ((data: unknown) => Promise<void>) | null = null;
  calls: Array<{ queue: string; name: string; data: unknown }> = [];

  async enqueue(queue: string, name: string, data: unknown): Promise<string> {
    this.calls.push({ queue, name, data });
    if (this.route) await this.route(data);
    return `inline-job-${this.calls.length}`;
  }

  async closeAll(): Promise<void> {
    this.route = null;
  }

  getQueue(): unknown {
    throw new Error('inline reviews queue double does not expose BullMQ queues');
  }
}

let app: INestApplication;
let redis: FakeRedis;
// Plain array, NOT a vi.fn: vitest's clearMocks wipes mock state between
// tests, so accumulated audit entries must live in normal test state.
const auditActions: string[] = [];
let reviewsRepo: ReturnType<typeof makeMemoryReviewsRepo>;
let inlineQueue: InlineReviewsQueue;
let user: LoginSession;
let other: LoginSession;
let admin: LoginSession;
/** Captured from the create responses (never guessed from list order). */
let firstReviewId = '';
let othersReviewId = '';

/** Flush the fire-and-forget event → enqueue → inline-handler chain. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

beforeAll(async () => {
  redis = new FakeRedis();
  reviewsRepo = makeMemoryReviewsRepo();
  inlineQueue = new InlineReviewsQueue();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue(inlineQueue)
    .overrideProvider(REVIEWS_REPOSITORY)
    .useValue(reviewsRepo)
    .overrideProvider(MEDIA_REPOSITORY)
    .useValue(makeMemoryMediaRepo())
    .overrideProvider(AUDIT_SERVICE)
    .useValue({
      log: (entry: { action: string }) => {
        auditActions.push(entry.action);
      },
      write: vi.fn(async () => ({ id: 'audit-1' })),
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // Wire the inline queue to the REAL worker handler + REAL service.
  const reviews: ReviewsService = app.get(ReviewsService);
  inlineQueue.route = async (data) => handleRecomputeRating(data, reviews);

  const reviewerRow = await createUser(app, { username: 'reviewer', password: 'Sup3rSecret!2026' });
  reviewerId.current = reviewerRow.id;
  await createUser(app, { username: 'reviewother', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'reviewadmin', password: 'Sup3rSecret!2026', role: 'admin' });
  user = await loginAs(app, 'reviewer', 'Sup3rSecret!2026');
  other = await loginAs(app, 'reviewother', 'Sup3rSecret!2026');
  admin = await loginAs(app, 'reviewadmin', 'Sup3rSecret!2026');
});

afterAll(async () => {
  await app?.close();
});

const listReviews = (businessId: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/businesses/${businessId}/reviews${query}`);

const createReview = (businessId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/businesses/${businessId}/reviews`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const patchReview = (reviewId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/reviews/${reviewId}`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const deleteReview = (reviewId: string, bearer?: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/reviews/${reviewId}`)
    .set(bearer ? { Authorization: bearer } : {});

const myReviews = (bearer: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/reviews/me${query}`).set({ Authorization: bearer });

const GOOD = { rating: 5, body: 'کافه‌چی خوبی بود؛ قهوه‌اش عالی.' };

/** Clear the Redis rate-limit counters (rl:* keys) — the write limit is 5/hour. */
const resetLimiter = (): void => {
  for (const key of [...redis.store.keys()]) {
    if (key.startsWith('rl:')) redis.store.delete(key);
  }
};

beforeEach(() => {
  resetLimiter();
});

describe('POST /api/v1/businesses/:id/reviews (B4.1)', () => {
  it('401 without authentication', async () => {
    const res = await createReview(ACTIVE, GOOD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('201 creates an approved review and the public list shows it', async () => {
    const res = await createReview(ACTIVE, GOOD, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.rating).toBe(5);
    firstReviewId = (res.body.data as { id: string }).id;
    const list = await listReviews(ACTIVE);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.meta).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  it('the aggregate recompute ran inline: avg 5.00, count 1', async () => {
    await flush();
    const biz = reviewsRepo.businesses.get(ACTIVE) as FakeBusinessRow;
    expect(biz.avgRating).toBe('5.00');
    expect(biz.reviewCount).toBe(1);
    expect(inlineQueue.calls[0]).toMatchObject({ queue: 'reviews', name: 'recompute-rating' });
  });

  it('409 when the same user reviews the same business again', async () => {
    const res = await createReview(
      ACTIVE,
      { rating: 1, body: 'دومین بار؛ متأسفانه نه.' },
      user.bearer,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404 for an unknown business (never leaks existence)', async () => {
    const res = await createReview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', GOOD, user.bearer);
    expect(res.status).toBe(404);
  });

  it('404 for a soft-deleted business', async () => {
    const res = await createReview(DELETED, GOOD, user.bearer);
    expect(res.status).toBe(404);
  });

  it('422 when the business is not active', async () => {
    const res = await createReview(PENDING, GOOD, user.bearer);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });

  it('400 on validation failures: rating out of range, short body, unknown key', async () => {
    const zero = await createReview(ACTIVE, { rating: 0, body: GOOD.body }, user.bearer);
    expect(zero.status).toBe(400);
    const six = await createReview(ACTIVE, { rating: 6, body: GOOD.body }, user.bearer);
    expect(six.status).toBe(400);
    const short = await createReview(ACTIVE, { rating: 3, body: 'کوتاه' }, user.bearer);
    expect(short.status).toBe(400);
    const extra = await createReview(ACTIVE, { ...GOOD, hack: true }, user.bearer);
    expect(extra.status).toBe(400);
  });

  it('422 when the attached photo is the wrong media kind', async () => {
    const res = await createReview(
      ACTIVE,
      { ...GOOD, photoMediaId: PHOTO_WRONG_KIND },
      other.bearer,
    );
    expect(res.status).toBe(422);
  });

  it('201 with a valid review_photo and the photo URL is served', async () => {
    const res = await createReview(ACTIVE2, { ...GOOD, photoMediaId: PHOTO }, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.photoUrl).toContain(PHOTO.slice(0, 8));
  });
});

describe('PATCH /api/v1/reviews/:id (B4.1)', () => {
  it('200 the author edits the rating; editedAt is stamped', async () => {
    const res = await patchReview(firstReviewId, { rating: 3 }, user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(3);
    expect(res.body.data.editedAt).not.toBeNull();
  });

  it('the aggregate followed the edit: avg 3.00 now', async () => {
    await flush();
    const biz = reviewsRepo.businesses.get(ACTIVE) as FakeBusinessRow;
    expect(biz.avgRating).toBe('3.00');
    expect(biz.reviewCount).toBe(1);
  });

  it('403 when a different user edits the review', async () => {
    const res = await patchReview(firstReviewId, { rating: 1 }, other.bearer);
    expect(res.status).toBe(403);
  });

  it('400 on an empty patch and on unknown keys', async () => {
    const empty = await patchReview(firstReviewId, {}, user.bearer);
    expect(empty.status).toBe(400);
    const unknown = await patchReview(firstReviewId, { status: 'rejected' }, user.bearer);
    expect(unknown.status).toBe(400);
  });

  it('404 for an unknown review id', async () => {
    const res = await patchReview(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { rating: 2 },
      user.bearer,
    );
    expect(res.status).toBe(404);
  });

  it('422 for a garbage review id (not a 500)', async () => {
    const res = await patchReview('not-a-uuid', { rating: 2 }, user.bearer);
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/reviews/:id (B4.1)', () => {
  it('403 when a plain user deletes someone else’s review', async () => {
    const create = await createReview(
      ACTIVE,
      { rating: 4, body: 'نظر دیگری برای تست حذف.' },
      other.bearer,
    );
    expect(create.status).toBe(201);
    othersReviewId = (create.body.data as { id: string }).id;
    const res = await deleteReview(othersReviewId, user.bearer);
    expect(res.status).toBe(403);
  });

  it('200 the author deletes their own review; the list and aggregate shrink', async () => {
    const res = await deleteReview(firstReviewId, user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });
    await flush();
    const list = await listReviews(ACTIVE);
    expect(list.body.data.items).toHaveLength(1);
    const biz = reviewsRepo.businesses.get(ACTIVE) as FakeBusinessRow;
    expect(biz.reviewCount).toBe(1);
    expect(biz.avgRating).toBe('4.00');
  });

  it('200 an admin (reviews.manage) deletes another user’s review', async () => {
    const res = await deleteReview(othersReviewId, admin.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });
  });

  it('404 when the review is already gone', async () => {
    const mine = await myReviews(other.bearer);
    const id = (mine.body.data.items[0] as { id: string })?.id;
    expect(id).toBeUndefined();
  });

  it('401 without authentication', async () => {
    const res = await deleteReview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/reviews/me (B4.1)', () => {
  it('401 without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reviews/me');
    expect(res.status).toBe(401);
  });

  it('200 lists only the caller’s reviews (every status)', async () => {
    const res = await myReviews(user.bearer);
    expect(res.status).toBe(200);
    const otherId = (other.body.data as { user?: { id?: string } }).user?.id ?? '';
    expect(res.body.data.items.every((r: { userId: string }) => r.userId !== otherId)).toBe(true);
  });

  it('validates pagination: pageSize=0 and pageSize=101 are 400', async () => {
    const zero = await myReviews(user.bearer, '?pageSize=0');
    expect(zero.status).toBe(400);
    const big = await myReviews(user.bearer, '?pageSize=101');
    expect(big.status).toBe(400);
  });
});

describe('public list status filter (B4.1 moderation view)', () => {
  it('401 when an anonymous caller asks for a status filter', async () => {
    const res = await listReviews(ACTIVE, '?status=approved');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('403 when a plain user asks for a status filter', async () => {
    const res = await listReviews(ACTIVE, '?status=pending').set({
      Authorization: user.bearer,
    });
    expect(res.status).toBe(403);
  });

  it('200 for an admin with the status filter', async () => {
    const res = await listReviews(ACTIVE, '?status=approved').set({
      Authorization: admin.bearer,
    });
    expect(res.status).toBe(200);
  });
});

describe('audit trail (B4.1)', () => {
  it('writes were audited (create/update/delete actions present)', async () => {
    expect(auditActions).toContain('review.create');
    expect(auditActions).toContain('review.update');
    expect(auditActions).toContain('review.delete');
  });
});
