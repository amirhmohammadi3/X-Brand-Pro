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
import { MODERATION_REPOSITORY } from '../src/modules/moderation/moderation.repository.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level moderation tests (B4.4) WITHOUT live services: the reports
 * repository and the reviews repository are in-memory fakes, Redis is
 * FakeRedis, the queue is a RECORDING double (the recompute JOB path is
 * covered end-to-end in reviews.api.spec.ts — here we assert the ENQUEUE
 * contract: a real status flip enqueues, an idempotent no-op does not).
 *
 * The real controllers, guards (RateLimit → JwtAuth → CsrfOrigin → Roles),
 * envelope and exception filter all run for real here — this is where the
 * RBAC matrix (user vs moderator vs admin) is pinned down.
 */

const REVIEW_A = '55555555-5555-4555-8555-555555555551'; // pending, 07:00 (oldest)
const REVIEW_B = '55555555-5555-4555-8555-555555555552'; // pending, 09:00
const REVIEW_C = '55555555-5555-4555-8555-555555555553'; // approved
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ = '11111111-1111-4111-8111-111111111111';

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

function reviewRow(id: string, status: 'approved' | 'pending', createdAt: Date): FakeReviewRow {
  return {
    id,
    businessId: BIZ,
    userId: '22222222-2222-4222-8222-222222222222',
    authorName: null,
    authorUsername: 'reviewer',
    rating: 3,
    body: 'متن نظر برای آزمون صف مدیریت.',
    status,
    photoMediaId: null,
    photoKey: null,
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
    createdAt,
    updatedAt: createdAt,
  };
}

/** The reviews-repo slice the moderation endpoints need (plus votes stubs). */
function makeMemoryReviewsRepo(rows: FakeReviewRow[]) {
  const map = new Map(rows.map((r) => [r.id, r]));
  return {
    rows: map,
    async findBusinessContext(businessId: string) {
      return businessId === BIZ ? { ownerId: null, status: 'active', deletedAt: null } : null;
    },
    async findById(id: string) {
      return map.get(id) ?? null;
    },
    async listByStatusAll(status: string, page: number, pageSize: number) {
      const items = [...map.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async moderateStatus(id: string, patch: { status: string; moderatorNote?: string | null }) {
      const row = map.get(id);
      if (!row) return null;
      Object.assign(row, {
        status: patch.status,
        moderatorNote: patch.moderatorNote ?? row.moderatorNote,
        updatedAt: new Date(),
      });
      return row;
    },
    async upsertVote(): Promise<void> {},
    async deleteVote(): Promise<boolean> {
      return false;
    },
    async findVoteByReviewAndUser(): Promise<1 | -1 | null> {
      return null;
    },
    async countVotes(): Promise<{ helpful: number; unhelpful: number }> {
      return { helpful: 0, unhelpful: 0 };
    },
    async recomputeRating(_businessId: string) {
      return { avgRating: '0.00', reviewCount: 0 };
    },
  };
}

/** The reports-repo fake: same one-per-reporter + triage semantics. The
 * real repo JOINs users for the reporter username; the fake resolves it
 * from a caller-supplied id→username map. */
function makeMemoryModerationRepo(reviewIds: string[], usernames: Record<string, string>) {
  const rows = new Map<
    string,
    {
      id: string;
      targetType: 'review' | 'reply';
      targetId: string;
      reporterUserId: string;
      reporterUsername: string;
      category: string;
      details: string | null;
      status: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
      reviewedBy: string | null;
      resolutionNote: string | null;
      reviewedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  let seq = 0;
  const repo = {
    rows,
    async reviewExists(reviewId: string) {
      return reviewIds.includes(reviewId);
    },
    async replyExists(): Promise<boolean> {
      return false;
    },
    async insertReport(input: {
      targetType: 'review' | 'reply';
      targetId: string;
      reporterUserId: string;
      reporterUsername: string;
      category: string;
      details: string | null;
    }) {
      const id = `${(seq += 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
      const row = {
        id,
        targetType: input.targetType,
        targetId: input.targetId,
        reporterUserId: input.reporterUserId,
        reporterUsername: usernames[input.reporterUserId] ?? 'unknown',
        category: input.category,
        details: input.details,
        status: 'pending' as const,
        reviewedBy: null,
        resolutionNote: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(id, row);
      return row;
    },
    async findReportById(id: string) {
      return rows.get(id) ?? null;
    },
    async findReportByReporterAndTarget(
      targetType: string,
      targetId: string,
      reporterUserId: string,
    ) {
      for (const r of rows.values()) {
        if (
          r.targetType === targetType &&
          r.targetId === targetId &&
          r.reporterUserId === reporterUserId
        ) {
          return r;
        }
      }
      return null;
    },
    async listReports(status: string | undefined, page: number, pageSize: number) {
      const wanted = status ?? 'pending';
      const items = [...rows.values()]
        .filter((r) => r.status === wanted)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async resolveReport(
      id: string,
      patch: { status: string; reviewedBy: string; resolutionNote?: string | null },
    ) {
      const row = rows.get(id);
      if (!row) return null;
      Object.assign(row, {
        status: patch.status,
        reviewedBy: patch.reviewedBy,
        ...(patch.resolutionNote !== undefined && patch.resolutionNote !== null
          ? { resolutionNote: patch.resolutionNote }
          : {}),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });
      return row;
    },
  };
  return repo as unknown as typeof repo & Record<string, unknown>;
}

/** Recording queue double: the ENQUEUE contract is the assertion here. */
class RecordingQueue {
  calls: Array<{ queue: string; name: string; data: unknown }> = [];
  async enqueue(queue: string, name: string, data: unknown): Promise<string> {
    this.calls.push({ queue, name, data });
    return `job-${this.calls.length}`;
  }
  async closeAll(): Promise<void> {}
  getQueue(): unknown {
    throw new Error('recording double exposes no BullMQ queues');
  }
}

let app: INestApplication;
let redis: FakeRedis;
const auditActions: string[] = [];
let reviewsRepo: ReturnType<typeof makeMemoryReviewsRepo>;
let moderationRepo: ReturnType<typeof makeMemoryModerationRepo>;
let queue: RecordingQueue;
let user: LoginSession;
let mod: LoginSession;
let admin: LoginSession;
/** The fake resolves the reporter username the way the real repo's JOIN does. */
const usernameById: Record<string, string> = {};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const resetLimiter = (): void => {
  for (const key of [...redis.store.keys()]) {
    if (key.startsWith('rl:')) redis.store.delete(key);
  }
};

beforeAll(async () => {
  redis = new FakeRedis();
  reviewsRepo = makeMemoryReviewsRepo([
    reviewRow(REVIEW_A, 'pending', new Date('2026-11-11T07:00:00Z')),
    reviewRow(REVIEW_B, 'pending', new Date('2026-11-11T09:00:00Z')),
    reviewRow(REVIEW_C, 'approved', new Date('2026-11-11T08:00:00Z')),
  ]);
  moderationRepo = makeMemoryModerationRepo([REVIEW_A, REVIEW_B, REVIEW_C], usernameById);
  queue = new RecordingQueue();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue(queue)
    .overrideProvider(REVIEWS_REPOSITORY)
    .useValue(reviewsRepo)
    .overrideProvider(MODERATION_REPOSITORY)
    .useValue(moderationRepo)
    .overrideProvider(MEDIA_REPOSITORY)
    .useValue({
      async findById(): Promise<null> {
        return null;
      },
    })
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

  const reporterRow = await createUser(app, {
    username: 'modreporter',
    password: 'Sup3rSecret!2026',
  });
  const modRow = await createUser(app, {
    username: 'modmod',
    password: 'Sup3rSecret!2026',
    role: 'moderator',
  });
  const adminRow = await createUser(app, {
    username: 'modadmin',
    password: 'Sup3rSecret!2026',
    role: 'admin',
  });
  user = await loginAs(app, 'modreporter', 'Sup3rSecret!2026');
  mod = await loginAs(app, 'modmod', 'Sup3rSecret!2026');
  admin = await loginAs(app, 'modadmin', 'Sup3rSecret!2026');
  // The fake resolves the reporter username the way the real repo's JOIN does.
  usernameById[reporterRow.id] = 'modreporter';
  usernameById[modRow.id] = 'modmod';
  usernameById[adminRow.id] = 'modadmin';
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  resetLimiter();
});

const postReport = (body: object, bearer?: string) =>
  request(app.getHttpServer())
    .post('/api/v1/reports')
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const reportQueue = (query = '', bearer?: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/moderation/reports${query}`)
    .set(bearer ? { Authorization: bearer } : {});

const resolveReport = (id: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/moderation/reports/${id}`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const reviewQueue = (query = '', bearer?: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/moderation/reviews${query}`)
    .set(bearer ? { Authorization: bearer } : {});

const flipReview = (id: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/moderation/reviews/${id}/status`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

describe('POST /api/v1/reports (B4.4)', () => {
  it('401 without authentication', async () => {
    const res = await postReport({ targetType: 'review', targetId: REVIEW_A, category: 'spam' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('400 on validation failures: bad category, other-without-details, unknown keys', async () => {
    const badCategory = await postReport(
      { targetType: 'review', targetId: REVIEW_A, category: 'harassment' },
      user.bearer,
    );
    expect(badCategory.status).toBe(400);
    const noDetails = await postReport(
      { targetType: 'review', targetId: REVIEW_A, category: 'other' },
      user.bearer,
    );
    expect(noDetails.status).toBe(400);
    const extra = await postReport(
      { targetType: 'review', targetId: REVIEW_A, category: 'spam', hack: true },
      user.bearer,
    );
    expect(extra.status).toBe(400);
  });

  it('400 a garbage targetId (schema-level — never a DB error)', async () => {
    const res = await postReport(
      { targetType: 'review', targetId: 'not-a-uuid', category: 'spam' },
      user.bearer,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('404 an unknown target (never leaks kind or state)', async () => {
    const res = await postReport(
      { targetType: 'review', targetId: UNKNOWN_ID, category: 'spam' },
      user.bearer,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('201 creates a pending report; the queue shows the reporter username', async () => {
    const res = await postReport(
      {
        targetType: 'review',
        targetId: REVIEW_A,
        category: 'offensive',
        details: 'محتوای توهین‌آمیز.',
      },
      user.bearer,
    );
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.report).toMatchObject({
      targetType: 'review',
      targetId: REVIEW_A,
      status: 'pending',
      category: 'offensive',
      reporterUsername: 'modreporter',
    });
  });

  it('409 a second report from the SAME reporter on the SAME target', async () => {
    const res = await postReport(
      { targetType: 'review', targetId: REVIEW_A, category: 'spam' },
      user.bearer,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('201 the SAME target from a DIFFERENT reporter is accepted (volume is the signal)', async () => {
    const res = await postReport(
      { targetType: 'review', targetId: REVIEW_A, category: 'spam' },
      admin.bearer,
    );
    expect(res.status).toBe(201);
  });

  it('writes report.create into the audit trail', async () => {
    expect(auditActions).toContain('report.create');
  });
});

describe('GET /api/v1/moderation/reports (B4.4 — the queue)', () => {
  it('401 anonymous and 403 for a plain user (reviews.manage required)', async () => {
    expect((await reportQueue()).status).toBe(401);
    const res = await reportQueue('', user.bearer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('200 the moderator sees the PENDING queue by default, oldest first', async () => {
    const res = await reportQueue('', mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(2); // the 201s above — both still pending
    const usernames = (res.body.data.items as Array<{ reporterUsername: string }>).map(
      (r) => r.reporterUsername,
    );
    // The reviewer reported at 08:00-ish before the admin — triage is oldest-first.
    expect(usernames[0]).toBe('modreporter');
  });

  it('200 the admin also reads the queue; ?status= filters', async () => {
    const res = await reportQueue('?status=actioned', admin.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(0);
  });
});

describe('PATCH /api/v1/moderation/reports/:id (B4.4 — resolution)', () => {
  let reportId = '';

  beforeAll(async () => {
    const queue = await reportQueue('', mod.bearer);
    reportId = (queue.body.data.items as Array<{ id: string }>)[0]!.id;
  });

  it('403 a plain user cannot resolve reports', async () => {
    const res = await resolveReport(reportId, { status: 'dismissed' }, user.bearer);
    expect(res.status).toBe(403);
  });

  it('400 a resolution cannot put a report BACK to pending', async () => {
    const res = await resolveReport(reportId, { status: 'pending' }, mod.bearer);
    expect(res.status).toBe(400);
  });

  it('200 the moderator resolves to actioned with a note; stamps are set', async () => {
    const res = await resolveReport(
      reportId,
      { status: 'actioned', resolutionNote: 'نظر حذف شد' },
      mod.bearer,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.report.status).toBe('actioned');
    expect(res.body.data.report.reviewedAt).not.toBeNull();
    expect(res.body.data.report.resolutionNote).toBe('نظر حذف شد');
  });

  it('404 an unknown report id (422 for garbage)', async () => {
    const res = await resolveReport(UNKNOWN_ID, { status: 'dismissed' }, mod.bearer);
    expect(res.status).toBe(404);
    const garbage = await resolveReport('nope', { status: 'dismissed' }, mod.bearer);
    expect(garbage.status).toBe(422);
  });

  it('writes moderation.report.resolve into the audit trail', async () => {
    expect(auditActions).toContain('moderation.report.resolve');
  });
});

describe('GET /api/v1/moderation/reviews (B4.4 — the review queue)', () => {
  it('403 a plain user cannot read the queue', async () => {
    const res = await reviewQueue('', user.bearer);
    expect(res.status).toBe(403);
  });

  it('200 the moderator sees the PENDING reviews, oldest first, public shape', async () => {
    const res = await reviewQueue('', mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(2);
    const ids = (res.body.data.items as Array<{ id: string; status: string }>).map((r) => r.id);
    expect(ids).toEqual([REVIEW_A, REVIEW_B]); // 07:00 then 09:00 — triage order
    expect((res.body.data.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'moderatorNote',
    );
  });

  it('200 ?status=approved filters to approved', async () => {
    const res = await reviewQueue('?status=approved', admin.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(1);
  });
});

describe('PATCH /api/v1/moderation/reviews/:id/status (B4.4 — the flip)', () => {
  it('403 a plain user cannot flip', async () => {
    const res = await flipReview(REVIEW_A, { status: 'approved' }, user.bearer);
    expect(res.status).toBe(403);
  });

  it('400 the body cannot set pending (only approved|rejected)', async () => {
    const res = await flipReview(REVIEW_A, { status: 'pending' }, mod.bearer);
    expect(res.status).toBe(400);
  });

  it('200 the moderator approves with a note — ONE recompute-rating job enqueued', async () => {
    const res = await flipReview(REVIEW_A, { status: 'approved', note: 'بررسی شد' }, mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('approved');
    expect(res.body.data.moderatorNote).toBe('بررسی شد');
    await flush();
    const flips = queue.calls.filter(
      (c) =>
        c.name === 'recompute-rating' && (c.data as { businessId?: string }).businessId === BIZ,
    );
    expect(flips).toHaveLength(1);
    expect(flips[0]).toMatchObject({ queue: 'reviews' });
  });

  it('200 an idempotent same-status flip enqueues NOTHING (no aggregate churn)', async () => {
    const before = queue.calls.length;
    const res = await flipReview(REVIEW_A, { status: 'approved' }, mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('approved');
    await flush();
    expect(queue.calls.length).toBe(before);
  });

  it('200 rejecting back to pending-free state re-enqueues (the flip changed again)', async () => {
    const before = queue.calls.filter(
      (c) =>
        c.name === 'recompute-rating' && (c.data as { businessId?: string }).businessId === BIZ,
    ).length;
    const res = await flipReview(REVIEW_A, { status: 'rejected', note: 'اسپم' }, mod.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('rejected');
    await flush();
    const after = queue.calls.filter(
      (c) =>
        c.name === 'recompute-rating' && (c.data as { businessId?: string }).businessId === BIZ,
    ).length;
    expect(after).toBe(before + 1);
  });

  it('404 an unknown review', async () => {
    const res = await flipReview(UNKNOWN_ID, { status: 'approved' }, mod.bearer);
    expect(res.status).toBe(404);
  });

  it('writes moderation.review.status into the audit trail', async () => {
    expect(auditActions).toContain('moderation.review.status');
  });
});
