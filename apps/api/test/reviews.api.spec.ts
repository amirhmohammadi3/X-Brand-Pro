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
import { SETTINGS_REPOSITORY, SettingsService } from '../src/modules/settings/settings.service.js';
import {
  handleRecomputeRating,
  handleRecomputeReputation,
  RECOMPUTE_RATING_JOB,
  RECOMPUTE_REPUTATION_JOB,
} from '../src/modules/reviews/reviews.jobs.js';
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
/** B4.6 — the reviewer's receipt media (kind verification_receipt). TWO rows:
 * the one-media-one-home rule means a receipt attached by one test can never
 * attach again in another. */
const RECEIPT = 'aaaaaaa1-0000-4000-8000-00000000000a';
const RECEIPT2 = 'aaaaaaa2-0000-4000-8000-00000000000a';
const ACTIVE2 = '14141414-1414-4141-8141-141414141414';
/** Set in beforeAll — the media fake resolves ownership lazily (the module
 * compiles before the users exist). */
const reviewerId = { current: 'pending' };
/** Set in beforeAll — the B4.3 reply tests bind it as ACTIVE4's owner. */
const ownerId = { current: 'pending' };

interface FakeBusinessRow {
  ownerId: string | null;
  status: string;
  deletedAt: Date | null;
  avgRating: string;
  reviewCount: number;
  /** B4.6 — the location the check-in validates against (only the B4.6
   * businesses carry it; absent = no check-in validation possible). */
  lat?: number | null;
  lng?: number | null;
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
  /** B4.6 — receipt + check-in proof columns (badge derives from them). */
  receiptMediaId: string | null;
  receiptKey: string | null;
  checkinAt: Date | null;
  checkinLat: number | null;
  checkinLng: number | null;
  /** B4.7 — first-review badge + the author's denormalised score. */
  isFirst: boolean;
  authorReputation: number;
  helpfulCount: number;
  unhelpfulCount: number;
  replyId: string | null;
  replyUserId: string | null;
  replyAuthorName: string | null;
  replyBody: string | null;
  replyEditedAt: Date | null;
  replyCreatedAt: Date | null;
  replyUpdatedAt: Date | null;
  moderatorNote: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** In-memory reviews repo mirroring the service's expected semantics. */
function makeMemoryReviewsRepo() {
  const businesses = new Map<string, FakeBusinessRow>([
    [
      ACTIVE,
      {
        ownerId: null,
        status: 'active',
        deletedAt: null,
        avgRating: '0.00',
        reviewCount: 0,
        // B4.6 — the check-in tests measure against this point.
        lat: 35.7,
        lng: 51.4,
      },
    ],
    [
      ACTIVE2,
      {
        ownerId: null,
        status: 'active',
        deletedAt: null,
        avgRating: '0.00',
        reviewCount: 0,
        lat: 35.7,
        lng: 51.4,
      },
    ],
    [
      PENDING,
      {
        ownerId: null,
        status: 'pending',
        deletedAt: null,
        avgRating: '0.00',
        reviewCount: 0,
        lat: 35.7,
        lng: 51.4,
      },
    ],
    [
      DELETED,
      {
        ownerId: null,
        status: 'active',
        deletedAt: new Date(),
        avgRating: '0.00',
        reviewCount: 0,
        lat: 35.7,
        lng: 51.4,
      },
    ],
  ]);
  const rows = new Map<string, FakeReviewRow>();
  // B4.2: vote store keyed "reviewId:userId" → 1 | -1 (unique upsert semantics).
  const votes = new Map<string, 1 | -1>();
  const voteKey = (reviewId: string, userId: string) => `${reviewId}:${userId}`;
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
  const syncCounts = (reviewId: string) => {
    const row = rows.get(reviewId);
    if (row) {
      const t = tally(reviewId);
      Object.assign(row, { helpfulCount: t.helpful, unhelpfulCount: t.unhelpful });
    }
  };
  // B4.3: reply store keyed by review_id + a per-review join sync (the real
  // repo LEFT JOINs review_replies; the fake copies the row onto the review).
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
  const syncReply = (reviewId: string) => {
    const row = rows.get(reviewId);
    if (!row) return;
    const reply = replies.get(reviewId);
    Object.assign(
      row,
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
      return b
        ? {
            ownerId: b.ownerId,
            status: b.status,
            deletedAt: b.deletedAt,
            lat: b.lat,
            lng: b.lng,
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
      authorUsername: string;
      status?: 'approved' | 'pending' | 'rejected';
      checkinAt?: Date | null;
      checkinLat?: number | null;
      checkinLng?: number | null;
      receiptMediaId?: string | null;
      isFirst?: boolean;
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
        status: input.status ?? 'approved',
        photoMediaId: input.photoMediaId,
        photoKey: input.photoMediaId ? `p-${input.photoMediaId.slice(0, 8)}.webp` : null,
        receiptMediaId: input.receiptMediaId ?? null,
        receiptKey: input.receiptMediaId ? `r-${input.receiptMediaId.slice(0, 8)}.webp` : null,
        checkinAt: input.checkinAt ?? null,
        checkinLat: input.checkinLat ?? null,
        checkinLng: input.checkinLng ?? null,
        isFirst: input.isFirst ?? false,
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(id, row);
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
      // Mirror the real repo (UPDATE + fresh findById): a NEW object so the
      // service's pre/post badge comparison sees distinct snapshots.
      const merged: FakeReviewRow = {
        ...row,
        ...patch,
        editedAt: new Date(),
        updatedAt: new Date(),
      };
      // The keys ride the LEFT JOINs: a cleared media id nulls its key.
      if (merged.photoMediaId === null) merged.photoKey = null;
      if (merged.receiptMediaId === null) merged.receiptKey = null;
      rows.set(id, merged);
      return merged;
    },
    async delete(id: string) {
      return rows.delete(id);
    },
    // ── B4.7 reputation doubles: the source counts computed off the same
    // in-memory rows (the faithful AVG/COUNT scheme of recomputeRating).
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
      for (const r of approved) {
        for (const [k, v] of votes) {
          if (k.startsWith(`${r.id}:`) && v === 1) helpful += 1;
        }
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
    async upsertVote(reviewId: string, userId: string, value: 1 | -1) {
      votes.set(voteKey(reviewId, userId), value);
      syncCounts(reviewId);
    },
    async deleteVote(reviewId: string, userId: string) {
      const removed = votes.delete(voteKey(reviewId, userId));
      syncCounts(reviewId);
      return removed;
    },
    async findVoteByReviewAndUser(reviewId: string, userId: string) {
      return votes.get(voteKey(reviewId, userId)) ?? null;
    },
    async countVotes(reviewId: string) {
      return tally(reviewId);
    },
    async recomputeRating(businessId: string) {
      return recompute(businessId);
    },

    // ── B4.3: reply store keyed by review_id (the one-per-review upsert
    // target) + the join sync so read/list responses observe the inline reply.
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
  };
  return repo as unknown as typeof repo & Record<string, unknown>;
}

/** The settings-repo fake (the spam filter reads its knobs through
 * SettingsService; tests prime keys via app.get(SettingsService).set). */
function makeFakeSettingsRepo() {
  const store = new Map<
    string,
    { key: string; value: unknown; isSecret: boolean; group: string }
  >();
  return {
    store,
    async findAll() {
      return [...store.values()].map((r) => ({ ...r, description: null }));
    },
    async findByKey(key: string) {
      const row = store.get(key);
      return row ? { ...row, description: null } : null;
    },
    async upsert(row: { key: string; value: unknown; isSecret: boolean; group: string }) {
      const created = { ...row, description: null, updatedAt: new Date() };
      store.set(row.key, created);
      return created;
    },
  };
}

function makeMemoryMediaRepo() {
  const media = new Map<
    string,
    {
      kind: string;
      ownerUserId: { current: string };
      attachedAt: Date | null;
      deletedAt: Date | null;
    }
  >([
    [PHOTO, { kind: 'review_photo', ownerUserId: reviewerId, attachedAt: null, deletedAt: null }],
    [
      PHOTO_WRONG_KIND,
      { kind: 'avatar', ownerUserId: reviewerId, attachedAt: null, deletedAt: null },
    ],
    // B4.6 — receipts owned by the reviewer (lazy owner like PHOTO).
    [
      RECEIPT,
      { kind: 'verification_receipt', ownerUserId: reviewerId, attachedAt: null, deletedAt: null },
    ],
    [
      RECEIPT2,
      { kind: 'verification_receipt', ownerUserId: reviewerId, attachedAt: null, deletedAt: null },
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
    // B4.6 — the REAL MediaService (bound in AppModule; only the repo is
    // overridden here) calls this through markAttachedQuietly.
    async markAttached(id: string) {
      const m = media.get(id);
      if (!m) return null;
      m.attachedAt = new Date();
      return { id, kind: m.kind, ownerUserId: m.ownerUserId.current, attachedAt: m.attachedAt };
    },
  } as unknown as Record<string, unknown>;
}

/**
 * Inline queue double: enqueue() immediately runs the reviews processor's
 * handler (the code the WORKER would run), so the tests exercise the full
 * event → enqueue → recompute path without a real Redis/BullMQ. The route
 * receives the JOB NAME too — B4.7 adds a second `reviews` job family
 * (recompute-reputation) that the same worker registration dispatches.
 */
class InlineReviewsQueue {
  route: ((name: string, data: unknown) => Promise<void>) | null = null;
  calls: Array<{ queue: string; name: string; data: unknown }> = [];

  async enqueue(queue: string, name: string, data: unknown): Promise<string> {
    this.calls.push({ queue, name, data });
    if (this.route) await this.route(name, data);
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
let owner: LoginSession;
let mod: LoginSession;
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
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
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

  // Wire the inline queue to the REAL worker handlers + REAL service (the
  // same dispatch the registerReviewsJobs worker registration runs).
  const reviews: ReviewsService = app.get(ReviewsService);
  inlineQueue.route = async (name, data) => {
    if (name === RECOMPUTE_RATING_JOB) await handleRecomputeRating(data, reviews);
    else if (name === RECOMPUTE_REPUTATION_JOB) await handleRecomputeReputation(data, reviews);
  };

  const reviewerRow = await createUser(app, { username: 'reviewer', password: 'Sup3rSecret!2026' });
  reviewerId.current = reviewerRow.id;
  await createUser(app, { username: 'reviewother', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'reviewadmin', password: 'Sup3rSecret!2026', role: 'admin' });
  const ownerRow = await createUser(app, { username: 'reviewowner', password: 'Sup3rSecret!2026' });
  ownerId.current = ownerRow.id;
  await createUser(app, { username: 'reviewmod', password: 'Sup3rSecret!2026', role: 'moderator' });
  user = await loginAs(app, 'reviewer', 'Sup3rSecret!2026');
  other = await loginAs(app, 'reviewother', 'Sup3rSecret!2026');
  admin = await loginAs(app, 'reviewadmin', 'Sup3rSecret!2026');
  owner = await loginAs(app, 'reviewowner', 'Sup3rSecret!2026');
  mod = await loginAs(app, 'reviewmod', 'Sup3rSecret!2026');
  // B4.3: `owner` owns the ACTIVE business — the DATA relationship (owner_id),
  // not a role tag, is what authorizes replies.
  (reviewsRepo.businesses.get(ACTIVE) as FakeBusinessRow).ownerId = ownerRow.id;
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

// ─── B4.2 helpful/unhelpful votes (HTTP level) ───────────────────────────────
// The B4.1 block above deletes both of its reviews by design, but `user` has
// still REVIEWED ACTIVE2 there (one review per user per business), so the
// vote tests register a fresh business in the in-memory fake and create on it.

const ACTIVE3 = '15151515-1515-4151-8151-151515151515';

const voteOn = (reviewId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .put(`/api/v1/reviews/${reviewId}/vote`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const unvoteOn = (reviewId: string, bearer?: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/reviews/${reviewId}/vote`)
    .set(bearer ? { Authorization: bearer } : {});

describe('PUT /api/v1/reviews/:id/vote (B4.2)', () => {
  let reviewId = '';

  beforeAll(async () => {
    reviewsRepo.businesses.set(ACTIVE3, {
      ownerId: null,
      status: 'active',
      deletedAt: null,
      avgRating: '0.00',
      reviewCount: 0,
    });
    const create = await createReview(
      ACTIVE3,
      { rating: 5, body: 'برای رأی‌گیری ساخته شد.' },
      user.bearer,
    );
    expect(create.status).toBe(201);
    reviewId = (create.body.data as { id: string }).id;
  });

  it('401 without authentication', async () => {
    const res = await voteOn(reviewId, { value: 1 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('400 an invalid vote value (0, 2, text, null) — the domain is {1, -1}', async () => {
    for (const value of [0, 2, 'helpful', null]) {
      const res = await voteOn(reviewId, { value }, other.bearer);
      expect(res.status).toBe(400);
    }
  });

  it('422 when the author votes on their own review', async () => {
    const res = await voteOn(reviewId, { value: 1 }, user.bearer);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });

  it('200 the first helpful vote returns the fresh tally', async () => {
    const res = await voteOn(reviewId, { value: 1 }, other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ helpful: 1, unhelpful: 0, myVote: 1 });
  });

  it('200 switching to unhelpful moves the vote (one vote per user per review)', async () => {
    const res = await voteOn(reviewId, { value: -1 }, other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ helpful: 0, unhelpful: 1, myVote: -1 });
  });

  it('200 re-voting the same value is idempotent (tally unchanged)', async () => {
    const res = await voteOn(reviewId, { value: -1 }, other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ helpful: 0, unhelpful: 1, myVote: -1 });
  });

  it('200 a second voter raises the helpful tally; the list carries the counts', async () => {
    const res = await voteOn(reviewId, { value: 1 }, admin.bearer);
    expect(res.body.data).toEqual({ helpful: 1, unhelpful: 1, myVote: 1 });
    const list = await listReviews(ACTIVE3);
    const row = (list.body.data.items as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ id: reviewId, helpfulCount: 1, unhelpfulCount: 1 });
  });

  it('404 an unknown review id (and a non-UUID id is 422)', async () => {
    const res = await voteOn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { value: 1 }, other.bearer);
    expect(res.status).toBe(404);
    const garbage = await voteOn('not-a-uuid', { value: 1 }, other.bearer);
    expect(garbage.status).toBe(422);
  });
});

describe('DELETE /api/v1/reviews/:id/vote (B4.2)', () => {
  let reviewId = '';

  beforeAll(async () => {
    // `user` already reviewed ACTIVE3 in the PUT block — the author here is `other`.
    const create = await createReview(
      ACTIVE3,
      { rating: 3, body: 'نظر جدید برای آزمودن حذف رأی.' },
      other.bearer,
    );
    expect(create.status).toBe(201);
    reviewId = (create.body.data as { id: string }).id;
  });

  it('401 without authentication', async () => {
    const res = await unvoteOn(reviewId);
    expect(res.status).toBe(401);
  });

  it('200 withdraws the vote and zeroes the tally', async () => {
    await voteOn(reviewId, { value: 1 }, other.bearer);
    const res = await unvoteOn(reviewId, other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ helpful: 0, unhelpful: 0, myVote: null });
  });

  it('200 is idempotent when no vote exists (double-tap is not an error)', async () => {
    const res = await unvoteOn(reviewId, other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ helpful: 0, unhelpful: 0, myVote: null });
  });

  it('404 an unknown review id', async () => {
    const res = await unvoteOn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other.bearer);
    expect(res.status).toBe(404);
  });
});

describe('vote audit trail (B4.2)', () => {
  it('votes are NOT audited (high-volume, no content) — only the review writes are', async () => {
    expect(auditActions).not.toContain('review.voted');
    expect(auditActions).not.toContain('review.vote.removed');
    expect(auditActions).toContain('review.create');
  });
});

// ─── B4.3 owner replies (HTTP level) ────────────────────────────────────────
// A fresh business whose owner_id IS the `owner` user — the reply
// authorization is the data relationship, exactly as the service checks it.

const ACTIVE4 = '16161616-1616-4161-8161-161616161616';
const PENDING_REVIEW = '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a';

const putReply = (reviewId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .put(`/api/v1/reviews/${reviewId}/reply`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const deleteReply = (reviewId: string, bearer?: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/reviews/${reviewId}/reply`)
    .set(bearer ? { Authorization: bearer } : {});

describe('PUT /api/v1/reviews/:id/reply (B4.3)', () => {
  let reviewId = '';

  beforeAll(async () => {
    reviewsRepo.businesses.set(ACTIVE4, {
      ownerId: ownerId.current,
      status: 'active',
      deletedAt: null,
      avgRating: '0.00',
      reviewCount: 0,
    });
    const create = await createReview(
      ACTIVE4,
      { rating: 2, body: 'سرویس کند بود و سفارش دیر رسید.' },
      user.bearer,
    );
    expect(create.status).toBe(201);
    reviewId = (create.body.data as { id: string }).id;
    // A pending review (invisible on the public page) for the 422 rule.
    reviewsRepo.rows.set(PENDING_REVIEW, {
      id: PENDING_REVIEW,
      businessId: ACTIVE4,
      userId: reviewerId.current,
      authorName: null,
      authorUsername: 'reviewer',
      rating: 5,
      body: 'نظر در انتظار تأیید ماندن است.',
      status: 'pending',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('401 without authentication', async () => {
    const res = await putReply(reviewId, { body: 'پاسخ صاحب کسب‌وکار.' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('400 on validation failures: too-short, too-long and unknown keys', async () => {
    const short = await putReply(reviewId, { body: 'م' }, owner.bearer);
    expect(short.status).toBe(400);
    const long = await putReply(reviewId, { body: 'ع'.repeat(1001) }, owner.bearer);
    expect(long.status).toBe(400);
    const extra = await putReply(reviewId, { body: 'پاسخ', hack: true }, owner.bearer);
    expect(extra.status).toBe(400);
  });

  it('403 a plain user (even the review author) may not speak for the business', async () => {
    const res = await putReply(reviewId, { body: 'پاسخ غیرمجاز.' }, user.bearer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('403 a moderator (reviews.manage) may NOT reply — moderation never speaks as the business', async () => {
    const res = await putReply(reviewId, { body: 'پاسخ ناظر.' }, mod.bearer);
    expect(res.status).toBe(403);
  });

  it('422 a pending review cannot be answered (invisible on the public page)', async () => {
    const res = await putReply(PENDING_REVIEW, { body: 'پاسخ.' }, owner.bearer);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });

  it('404 an unknown review id (and a non-UUID id is 422)', async () => {
    const res = await putReply(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { body: 'پاسخ.' },
      owner.bearer,
    );
    expect(res.status).toBe(404);
    const garbage = await putReply('not-a-uuid', { body: 'پاسخ.' }, owner.bearer);
    expect(garbage.status).toBe(422);
  });

  it('200 the owner posts the FIRST reply — created=true, inline on the public list', async () => {
    const res = await putReply(
      reviewId,
      { body: 'عذرخواهی می‌کنیم؛ کد تخفیف برای سفارش بعدی فعال شد.' },
      owner.bearer,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.reply.body).toContain('عذرخواهی');
    expect(res.body.data.reply.editedAt).toBeNull();
    const list = await listReviews(ACTIVE4);
    const row = (list.body.data.items as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({ id: reviewId });
    expect((row.reply as Record<string, unknown>).body).toContain('عذرخواهی');
  });

  it('200 a second PUT edits the SAME reply — created=false, editedAt stamped, authorship kept', async () => {
    const res = await putReply(
      reviewId,
      { body: 'پاسخ ویرایش‌شده: کد تخفیف ۲۰٪ فعال شد.' },
      owner.bearer,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(false);
    expect(res.body.data.reply.editedAt).not.toBeNull();
    expect(res.body.data.reply.userId).toBe(ownerId.current);
    const list = await listReviews(ACTIVE4);
    const row = (list.body.data.items as Array<Record<string, unknown>>)[0]!;
    expect((row.reply as Record<string, unknown>).body).toContain('۲۰٪');
  });

  it('200 an admin (businesses.manage) edits the same row — provenance stays the original replier', async () => {
    const res = await putReply(
      reviewId,
      { body: 'ویرایش مدیر: با پشتیبانی تماس بگیرید.' },
      admin.bearer,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(false);
    expect(res.body.data.reply.userId).toBe(ownerId.current);
  });

  it('the aggregate was NOT touched by replies (replies never re-rate the business)', async () => {
    await flush();
    const biz = reviewsRepo.businesses.get(ACTIVE4) as FakeBusinessRow;
    expect(biz.avgRating).toBe('2.00'); // from the create only
    const recomputeCalls = inlineQueue.calls.filter(
      (c) =>
        c.name === 'recompute-rating' && (c.data as { businessId?: string }).businessId === ACTIVE4,
    );
    expect(recomputeCalls).toHaveLength(1); // the review create, nothing else
  });
});

describe('DELETE /api/v1/reviews/:id/reply (B4.3)', () => {
  let reviewId = '';

  beforeAll(async () => {
    // The reply created/edited above still exists on this review.
    reviewId = (
      (await listReviews(ACTIVE4)).body.data.items as Array<{ id: string; reply: unknown }>
    )[0]!.id;
  });

  it('401 without authentication', async () => {
    const res = await deleteReply(reviewId);
    expect(res.status).toBe(401);
  });

  it('403 a plain user may not remove the owner’s reply', async () => {
    const res = await deleteReply(reviewId, user.bearer);
    expect(res.status).toBe(403);
  });

  it('200 a moderator (reviews.manage) takes the reply down', async () => {
    const res = await deleteReply(reviewId, mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });
    const list = await listReviews(ACTIVE4);
    const row = (list.body.data.items as Array<Record<string, unknown>>)[0]!;
    expect(row.reply).toBeNull();
  });

  it('200 is idempotent when no reply exists (double-tap is not an error)', async () => {
    const res = await deleteReply(reviewId, owner.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: false });
  });

  it('200 the owner re-replies and then removes it themselves', async () => {
    const put = await putReply(reviewId, { body: 'پاسخ دوم پس از رفع مشکل.' }, owner.bearer);
    expect(put.status).toBe(200);
    expect(put.body.data.created).toBe(true); // the takedown freed the slot
    const del = await deleteReply(reviewId, owner.bearer);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true });
  });

  it('404 an unknown review id', async () => {
    const res = await deleteReply('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner.bearer);
    expect(res.status).toBe(404);
  });
});

describe('reply audit trail (B4.3)', () => {
  it('reply writes ARE audited (business speech, unlike votes)', async () => {
    expect(auditActions).toContain('review.reply.upsert');
    expect(auditActions).toContain('review.reply.delete');
  });
});

// ─── B4.5 automatic spam/fraud filter (HTTP level) ──────────────────────
// The settings knobs are primed through the REAL SettingsService over the
// fake settings repo — the exact path production uses (set → cache
// invalidate → next create re-reads). The velocity counters ride the
// FakeRedis the rate limiter already uses; `resetSpamCounters` gives each
// scenario a deterministic hour bucket.

const ACTIVE5 = '17171717-1717-4171-8171-171717171717';
const ACTIVE6 = '18181818-1818-4181-8181-181818181818';
const ACTIVE7 = '19191919-1919-4191-8191-191919191919';
const CLEAN_BODY = 'کافه‌چی خوبی بود؛ دسرش بی‌نظیر بود.';

/** Wipe the spam hour-bucket counters (the rl:* limiter keys are separate). */
const resetSpamCounters = (): void => {
  for (const key of [...redis.store.keys()]) {
    if (key.startsWith('spam:')) redis.store.delete(key);
  }
};

describe('POST /businesses/:id/reviews — the spam filter (B4.5)', () => {
  beforeAll(async () => {
    for (const id of [ACTIVE5, ACTIVE6, ACTIVE7]) {
      reviewsRepo.businesses.set(id, {
        ownerId: null,
        status: 'active',
        deletedAt: null,
        avgRating: '0.00',
        reviewCount: 0,
      });
    }
    // The admin-managed word list — the prompt's «کلمات قابل مدیریت».
    await app.get(SettingsService).set('moderation.spam.blockedWords', ['تبلیغات']);
    resetSpamCounters();
  });

  it('201 a CLEAN review is created approved and publicly listed', async () => {
    const res = await createReview(ACTIVE5, { rating: 5, body: CLEAN_BODY }, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('approved');
    const list = await listReviews(ACTIVE5);
    expect(list.body.data.meta.total).toBe(1);
    await flush();
  });

  it('201 a review with a BLOCKED WORD is created pending and stays off the public page', async () => {
    const res = await createReview(
      ACTIVE5,
      { rating: 1, body: 'این کافه فقط تبلیغات می‌کند.' },
      other.bearer,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    const list = await listReviews(ACTIVE5);
    expect(list.body.data.meta.total).toBe(1); // only the approved one
    await flush();
  });

  it('201 a DUPLICATE body (same user, another business) is created pending', async () => {
    const res = await createReview(ACTIVE6, { rating: 4, body: CLEAN_BODY }, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending'); // duplicate_text signal
    await flush();
  });

  it('201 ANOTHER USER posting the same body is not a duplicate (per-user signal)', async () => {
    const res = await createReview(ACTIVE5, { rating: 4, body: CLEAN_BODY }, mod.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('approved');
  });

  it('201 a VELOCITY excess is demoted pending (threshold primed to 1)', async () => {
    await app.get(SettingsService).set('moderation.spam.maxReviewsPerHour', 1);
    // `user` already posted twice above (counters bumped) — the next one exceeds.
    const res = await createReview(
      ACTIVE7,
      { rating: 5, body: 'نظر تازه و منحصر برای سرعت.' },
      user.bearer,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    await app.get(SettingsService).set('moderation.spam.maxReviewsPerHour', 5);
  });

  it('201 a fresh USER under the velocity threshold is created approved', async () => {
    const res = await createReview(
      ACTIVE6,
      { rating: 5, body: 'نظر کاربر تازه و مستقل.' },
      admin.bearer,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('approved');
  });
});

// ── B4.6 verified reviews (check-in, receipt, badge) — HTTP level ────────────

/** Fresh businesses for this suite (one review per user per business — the
 * B4.1 rule — means every create test needs its own (user, business) pair).
 * ~111 m from the fake point (35.7, 51.4) is inside the 250 m radius; ~2.2 km
 * is outside it. */
const B46A = '2a2a2a2a-2a2a-42a2-82a2-2a2a2a2a2a2a';
const B46B = '2b2b2b2b-2b2b-42b2-82b2-2b2b2b2b2b2b';
const B46C = '2c2c2c2c-2c2c-42c2-82c2-2c2c2c2c2c2c';
const B46D = '2d2d2d2d-2d2d-42d2-82d2-2d2d2d2d2d2d';
const NEAR = { lat: 35.701, lng: 51.4 };
const FAR = { lat: 35.72, lng: 51.4 };

beforeAll(async () => {
  for (const id of [B46A, B46B, B46C, B46D]) {
    reviewsRepo.businesses.set(id, {
      ownerId: null,
      status: 'active',
      deletedAt: null,
      avgRating: '0.00',
      reviewCount: 0,
      lat: 35.7,
      lng: 51.4,
    });
  }
});

describe('POST /businesses/:id/reviews — check-in + receipt (B4.6)', () => {
  it('201 with a VALID check-in: verified=true, checkinAt echoed, coordinates never leak', async () => {
    const res = await createReview(B46A, { ...GOOD, checkin: NEAR }, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.checkinVerified).toBe(true);
    expect(typeof res.body.data.checkinAt).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('35.701');
  });

  it('422 with an out-of-radius check-in (details carry reason + radius)', async () => {
    const res = await createReview(B46A, { ...GOOD, checkin: FAR }, other.bearer);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.details).toMatchObject({ reason: 'too_far', radiusM: 250 });
  });

  it('422 with a future check-in beyond the 300 s tolerance', async () => {
    const res = await createReview(
      B46B,
      { ...GOOD, checkin: { ...NEAR, at: new Date(Date.now() + 3600_000).toISOString() } },
      user.bearer,
    );
    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ reason: 'in_future' });
  });

  it('422 with a check-in older than 30 days', async () => {
    const res = await createReview(
      B46B,
      { ...GOOD, checkin: { ...NEAR, at: new Date(Date.now() - 31 * 86400_000).toISOString() } },
      other.bearer,
    );
    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ reason: 'too_old' });
  });

  it('400 with a malformed check-in (lat out of WGS84 range)', async () => {
    const res = await createReview(
      B46B,
      { ...GOOD, checkin: { lat: 95, lng: 51.4 } },
      admin.bearer,
    );
    expect(res.status).toBe(400);
  });

  it('201 with a receipt: verified=true via receipt, receiptUrl served, checkinVerified=false', async () => {
    const res = await createReview(B46B, { ...GOOD, receiptMediaId: RECEIPT }, user.bearer);
    expect(res.status).toBe(201);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.checkinVerified).toBe(false);
    // MediaUrlService serves the storage key under the /media mount.
    expect(res.body.data.receiptUrl).toBe('/media/r-aaaaaaa1.webp');
  });

  it('400 with a non-UUID receiptMediaId (zod pipe, before any repo call)', async () => {
    const res = await createReview(B46C, { ...GOOD, receiptMediaId: 'not-a-uuid' }, user.bearer);
    expect(res.status).toBe(400);
  });

  it('422 when a review_photo is offered as a receipt (kinds are not interchangeable)', async () => {
    const res = await createReview(B46C, { ...GOOD, receiptMediaId: PHOTO }, other.bearer);
    expect(res.status).toBe(422);
  });
});

describe('PATCH /reviews/:id — check-in/receipt lifecycle (B4.6)', () => {
  it('adding a check-in on edit flips the badge (verified=true)', async () => {
    const create = await createReview(B46C, GOOD, user.bearer);
    expect(create.body.data.verified).toBe(false);
    const id = create.body.data.id as string;
    const res = await patchReview(id, { checkin: NEAR }, user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.checkinVerified).toBe(true);
  });

  it('an out-of-radius check-in on edit is 422 and leaves the review unverified', async () => {
    const create = await createReview(B46A, GOOD, admin.bearer);
    const id = create.body.data.id as string;
    const res = await patchReview(id, { checkin: FAR }, admin.bearer);
    expect(res.status).toBe(422);
    const after = await myReviews(admin.bearer);
    const row = (after.body.data.items as Array<{ id: string; verified: boolean }>).find(
      (r) => r.id === id,
    );
    expect(row?.verified).toBe(false);
  });

  it('clearing the check-in (null) drops the badge when no receipt remains', async () => {
    const create = await createReview(B46A, { ...GOOD, checkin: NEAR }, mod.bearer);
    const id = create.body.data.id as string;
    const res = await patchReview(id, { checkin: null }, mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(false);
    expect(res.body.data.checkinAt).toBeNull();
  });

  it('receipt clear (null) keeps the badge while a check-in remains', async () => {
    // RECEIPT is owned by `user` (the reviewer) — only the owner may attach
    // it; RECEIPT2 because RECEIPT already attached to the B46B review above
    // (one media one home).
    const create = await createReview(
      B46D,
      { ...GOOD, checkin: NEAR, receiptMediaId: RECEIPT2 },
      user.bearer,
    );
    const id = create.body.data.id as string;
    const res = await patchReview(id, { receiptMediaId: null }, user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.receiptUrl).toBeNull();
    expect(res.body.data.verified).toBe(true);
  });

  it('the author may not add a check-in to SOMEONE ELSE’s review (403)', async () => {
    const create = await createReview(B46C, GOOD, other.bearer);
    const id = create.body.data.id as string;
    const res = await patchReview(id, { checkin: NEAR }, user.bearer);
    expect(res.status).toBe(403);
  });
});

// ── B4.7 reputation — HTTP level ─────────────────────────────────────────────

describe('B4.7 — first-review badge, author level, /users/me/reputation', () => {
  // FRESH users: the first-review stamp + the velocity filter both depend on
  // the author's history — the suites above have long histories.
  const B47A = '3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a';
  const B47B = '3b3b3b3b-3b3b-43b3-83b3-3b3b3b3b3b3b';
  let first: LoginSession;
  let second: LoginSession;

  beforeAll(async () => {
    for (const id of [B47A, B47B]) {
      reviewsRepo.businesses.set(id, {
        ownerId: null,
        status: 'active',
        deletedAt: null,
        avgRating: '0.00',
        reviewCount: 0,
      });
    }
    await createUser(app, { username: 'b47first', password: 'Sup3rSecret!2026' });
    await createUser(app, { username: 'b47second', password: 'Sup3rSecret!2026' });
    first = await loginAs(app, 'b47first', 'Sup3rSecret!2026');
    second = await loginAs(app, 'b47second', 'Sup3rSecret!2026');
  });

  const reputationOf = (bearer: string) =>
    request(app.getHttpServer()).get('/api/v1/users/me/reputation').set({ Authorization: bearer });

  it('401 on /users/me/reputation without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/me/reputation');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('stamps isFirstReview=true on the first review, false on the second; authorLevel rides every payload', async () => {
    const firstReview = await createReview(B47A, GOOD, first.bearer);
    expect(firstReview.status).toBe(201);
    expect(firstReview.body.data.isFirstReview).toBe(true);
    expect(firstReview.body.data.authorLevel).toBe('newcomer');
    // A DIFFERENT body — the B4.5 duplicate signal flags identical texts
    // across businesses, and this suite tests reputation, not spam.
    const secondReview = await createReview(
      B47B,
      { rating: 4, body: 'غذای خوشمزه‌ای داشتیم و برخورد پرسنل خوب بود.' },
      first.bearer,
    );
    expect(secondReview.status).toBe(201);
    expect(secondReview.body.data.isFirstReview).toBe(false);
    // The public list carries the same trust fields.
    const list = await listReviews(B47A);
    expect(list.body.data.items[0].isFirstReview).toBe(true);
  });

  it('GET /users/me/reputation answers the live formula', async () => {
    await flush(); // the created events ran the inline rating+reputation jobs
    const res = await reputationOf(first.bearer);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const { points, level, stats } = res.body.data as {
      points: number;
      level: string;
      stats: { approvedReviews: number; verifiedReviews: number; helpfulVotesReceived: number };
    };
    expect(stats.approvedReviews).toBe(2);
    expect(stats.verifiedReviews).toBe(0);
    expect(points).toBe(20);
    expect(level).toBe('newcomer');
  });

  it('a helpful vote shifts the AUTHOR\u2019s helpfulVotesReceived (not the voter\u2019s)', async () => {
    const list = await listReviews(B47A);
    const target = (list.body.data.items as Array<{ id: string }>)[0]!;
    const vote = await request(app.getHttpServer())
      .put(`/api/v1/reviews/${target.id}/vote`)
      .set({ Authorization: second.bearer })
      .send({ value: 1 });
    expect(vote.status).toBe(200);
    await flush();
    const author = await reputationOf(first.bearer);
    expect(author.body.data.stats.helpfulVotesReceived).toBe(1);
    expect(author.body.data.points).toBe(22);
    // The voter's own tally is untouched by their vote.
    const voter = await reputationOf(second.bearer);
    expect(voter.body.data.stats.helpfulVotesReceived).toBe(0);
    expect(voter.body.data.points).toBe(0);
  });

  it('the moderation takedown re-derives the score (rejected review stops counting)', async () => {
    const list = await listReviews(B47B);
    const target = (list.body.data.items as Array<{ id: string }>)[0]!;
    const flip = await request(app.getHttpServer())
      .patch(`/api/v1/moderation/reviews/${target.id}/status`)
      .set({ Authorization: admin.bearer })
      .send({ status: 'rejected' });
    expect(flip.status).toBe(200);
    await flush();
    const after = await reputationOf(first.bearer);
    const stats = after.body.data.stats as {
      approvedReviews: number;
      helpfulVotesReceived: number;
    };
    expect(stats.approvedReviews).toBe(1);
    expect(stats.helpfulVotesReceived).toBe(1);
    expect(after.body.data.points).toBe(12);
  });
});
