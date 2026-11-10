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
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { REVIEWS_REPOSITORY } from '../src/modules/reviews/reviews.repository.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level public-profile tests (B4.10) WITHOUT live services: users/
 * sessions in-memory (real UsersService on top), reviews repository an
 * in-memory fake, Redis FakeRedis, audit a spy. The REAL controllers, route
 * ordering (GET /users/me must still hit ProfileController, not
 * /users/:username), guards, envelope and exception filter run for real.
 */

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
  receiptMediaId: string | null;
  receiptKey: string | null;
  checkinAt: Date | null;
  checkinLat: number | null;
  checkinLng: number | null;
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

/** In-memory reviews repo — only the reads the profile endpoints use. */
function makeMemoryProfileReviewsRepo() {
  const rows = new Map<string, FakeReviewRow>();
  let seq = 0;
  const stats = new Map<
    string,
    { approvedReviews: number; verifiedReviews: number; helpfulVotesReceived: number }
  >();
  const repo = {
    rows,
    async reputationStats(userId: string) {
      return (
        stats.get(userId) ?? { approvedReviews: 0, verifiedReviews: 0, helpfulVotesReceived: 0 }
      );
    },
    async listApprovedByUser(userId: string, page: number, pageSize: number) {
      const items = [...rows.values()]
        .filter((r) => r.userId === userId && r.status === 'approved')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    /** Test helper: seed a review row with sensible defaults. */
    seed(overrides: Partial<FakeReviewRow>): FakeReviewRow {
      seq += 1;
      const row: FakeReviewRow = {
        id: `cccccccc-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
        businessId: '11111111-1111-4111-8111-111111111111',
        userId: 'pending',
        authorName: null,
        authorUsername: 'reviewer',
        rating: 5,
        body: 'کیفیت خدمات فوق‌العاده بود و پرسنل بسیار محترم.',
        status: 'approved',
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
        createdAt: new Date(Date.now() + seq * 1000),
        updatedAt: new Date(),
        ...overrides,
      };
      rows.set(row.id, row);
      return row;
    },
    seedStats(
      userId: string,
      value: { approvedReviews: number; verifiedReviews: number; helpfulVotesReceived: number },
    ) {
      stats.set(userId, value);
    },
  };
  return repo;
}

function makeFakeSettingsRepo() {
  const store = new Map<
    string,
    { key: string; value: unknown; isSecret: boolean; group: string }
  >();
  return {
    async findAll() {
      return [...store.values()].map((r) => ({ ...r, description: null }));
    },
    async findByKey(key: string) {
      const row = store.get(key);
      return row ? { ...row, description: null } : null;
    },
    async upsert(row: { key: string; value: unknown; isSecret: boolean; group: string }) {
      store.set(row.key, { ...row, description: null, updatedAt: new Date() });
      return row;
    },
  };
}

let app: INestApplication;
let redis: FakeRedis;
let reviewsRepo: ReturnType<typeof makeMemoryProfileReviewsRepo>;
let userRepo: ReturnType<typeof makeMemoryUserRepo>;

let reviewer: LoginSession;

beforeAll(async () => {
  redis = new FakeRedis();
  reviewsRepo = makeMemoryProfileReviewsRepo();
  userRepo = makeMemoryUserRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(userRepo)
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined) })
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(REVIEWS_REPOSITORY)
    .useValue(reviewsRepo)
    .overrideProvider(AUDIT_SERVICE)
    .useValue({ log: vi.fn(), write: vi.fn(async () => ({ id: 'a' })) })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // The profiled user: display name + avatar + reputation + reviews.
  const reviewerRow = await createUser(app, {
    username: 'reviewer',
    password: 'Sup3rSecret!2026',
  });
  await userRepo.updateProfile(reviewerRow.id, { displayName: 'علی رضایی' } as never);
  const mediaId = 'dddddddd-0000-4000-8000-000000000001';
  userRepo.mediaRows.set(mediaId, {
    key: 'avatars/reviewer.webp',
    thumbKey: 'avatars/reviewer-thumb.webp',
    deletedAt: null,
    ownerUserId: reviewerRow.id,
    kind: 'avatar',
  } as never);
  await userRepo.setAvatarMediaId(reviewerRow.id, mediaId);
  // A blocked user with the same shape — must 404 exactly like an unknown one.
  const blockedRow = await createUser(app, {
    username: 'blockedguy',
    password: 'Sup3rSecret!2026',
  });
  // createUser does not forward `status` — flip it through the repo directly.
  await userRepo.updateStatus(blockedRow.id, 'blocked');

  reviewer = await loginAs(app, 'reviewer', 'Sup3rSecret!2026');

  reviewsRepo.seedStats(reviewerRow.id, {
    approvedReviews: 12,
    verifiedReviews: 3,
    helpfulVotesReceived: 7,
  });
  reviewsRepo.seed({ userId: reviewerRow.id, authorUsername: 'reviewer' });
  reviewsRepo.seed({ userId: reviewerRow.id, authorUsername: 'reviewer', rating: 3 });
  reviewsRepo.seed({
    userId: reviewerRow.id,
    authorUsername: 'reviewer',
    status: 'pending',
    body: 'این نظر در انتظار بررسی است و نباید عمومی شود.',
  });
  // Another user's review — must never appear on the reviewer's profile.
  reviewsRepo.seed({
    userId: 'eeeeeeee-0000-4000-8000-00000000000e',
    authorUsername: 'someoneelse',
  });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  for (const key of [...redis.store.keys()]) {
    if (key.startsWith('rl:')) redis.store.delete(key);
  }
});

const getProfile = (username: string) =>
  request(app.getHttpServer()).get(`/api/v1/users/${username}`);

const getProfileReviews = (username: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/users/${username}/reviews${query}`);

describe('GET /api/v1/users/:username (B4.10)', () => {
  it('200 public profile: identity + avatar + level + live stats + joinedAt', async () => {
    const res = await getProfile('reviewer');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.username).toBe('reviewer');
    expect(res.body.data.displayName).toBe('علی رضایی');
    expect(res.body.data.avatarUrl).toContain('avatars/reviewer-thumb.webp');
    expect(res.body.data.level).toBe('newcomer'); // users.reputation_points is 0 (async recompute owns the score)
    expect(res.body.data.stats).toEqual({
      approvedReviews: 12,
      verifiedReviews: 3,
      helpfulVotesReceived: 7,
    });
    expect(typeof res.body.data.joinedAt).toBe('string');
    // Privacy: the raw score and any contact field never leave the server.
    expect(res.body.data.points).toBeUndefined();
    expect(res.body.data.email).toBeUndefined();
    expect(res.body.data.phone).toBeUndefined();
  });

  it('404 an unknown username and a BLOCKED user with the identical payload shape (no existence leak)', async () => {
    const unknown = await getProfile('no-such-user');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    const blocked = await getProfile('blockedguy');
    expect(blocked.status).toBe(404);
    expect(blocked.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /users/me still resolves the CALLER’S own profile (route order regression guard)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set({ Authorization: reviewer.bearer });
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('reviewer');
    // …and /users/me/reputation (B4.7) still works on the reviews controller.
    const rep = await request(app.getHttpServer())
      .get('/api/v1/users/me/reputation')
      .set({ Authorization: reviewer.bearer });
    expect(rep.status).toBe(200);
    expect(rep.body.data.stats.approvedReviews).toBe(12);
  });
});

describe('GET /api/v1/users/:username/reviews (B4.10)', () => {
  it('200 approved-only reviews, newest first; pending and other users’ rows excluded', async () => {
    const res = await getProfileReviews('reviewer');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const items = res.body.data.items;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.status).toBe('approved');
      expect(item.authorUsername).toBe('reviewer');
    }
    // Newest first.
    expect(items[0].rating).toBe(3);
    expect(items[1].rating).toBe(5);
    expect(res.body.data.meta).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  it('paginates (?page/?pageSize) and 404s an unknown username', async () => {
    const paged = await getProfileReviews('reviewer', '?page=1&pageSize=1');
    expect(paged.status).toBe(200);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.meta.totalPages).toBe(2);
    const missing = await getProfileReviews('no-such-user');
    expect(missing.status).toBe(404);
  });

  it('404 the reviews list of a BLOCKED user too', async () => {
    const res = await getProfileReviews('blockedguy');
    expect(res.status).toBe(404);
  });
});
