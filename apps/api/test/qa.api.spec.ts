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
import { QA_REPOSITORY } from '../src/modules/qa/qa.repository.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level Q&A tests (B4.8) WITHOUT live services: Redis is FakeRedis, the
 * user/session repositories are in-memory fakes, the QA repository is an
 * in-memory fake (the real SQL needs Postgres — Docker follow-up), the
 * audit service is a capturing spy. The REAL controllers, guards
 * (RateLimit → JwtAuth → CsrfOrigin → Roles), envelope and exception filter
 * all run for real here.
 */

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const PENDING = '12121212-1212-4121-8121-121212121212';
const DELETED = '13131313-1313-4131-8131-131313131313';

interface FakeBusinessRow {
  ownerId: string | null;
  status: string;
  deletedAt: Date | null;
}

interface FakeQuestionRow {
  id: string;
  businessId: string;
  userId: string;
  authorName: string | null;
  authorUsername: string;
  body: string;
  status: 'approved' | 'pending' | 'rejected';
  answerId: string | null;
  answerUserId: string | null;
  answerAuthorName: string | null;
  answerBody: string | null;
  answerEditedAt: Date | null;
  answerCreatedAt: Date | null;
  answerUpdatedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeAnswerRow {
  id: string;
  questionId: string;
  userId: string;
  authorName: string | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Set in beforeAll — the owner fake binds this id as ACTIVE's owner. */
const ownerId = { current: 'pending' };
/** userId → username (populated in beforeAll) so the fake can denormalise authorUsername. */
const usernames = new Map<string, string>();

/** In-memory QA repo mirroring the service's expected semantics. */
function makeMemoryQaRepo() {
  const businesses = new Map<string, FakeBusinessRow>([
    [ACTIVE, { ownerId: null, status: 'active', deletedAt: null }],
    [PENDING, { ownerId: null, status: 'pending', deletedAt: null }],
    [DELETED, { ownerId: null, status: 'active', deletedAt: new Date() }],
  ]);
  const rows = new Map<string, FakeQuestionRow>();
  // B4.8: answer store keyed by question_id (one answer per question).
  const answers = new Map<string, FakeAnswerRow>();
  let seq = 0;
  /** The real repo LEFT JOINs the answer onto the question — the fake syncs it. */
  const syncJoin = (questionId: string) => {
    const q = rows.get(questionId);
    if (!q) return;
    const a = answers.get(questionId);
    Object.assign(
      q,
      a
        ? {
            answerId: a.id,
            answerUserId: a.userId,
            answerAuthorName: a.authorName,
            answerBody: a.body,
            answerEditedAt: a.editedAt,
            answerCreatedAt: a.createdAt,
            answerUpdatedAt: a.updatedAt,
          }
        : {
            answerId: null,
            answerUserId: null,
            answerAuthorName: null,
            answerBody: null,
            answerEditedAt: null,
            answerCreatedAt: null,
            answerUpdatedAt: null,
          },
    );
  };
  const sortNewestFirst = (list: FakeQuestionRow[]) =>
    [...list].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1),
    );
  const repo = {
    businesses,
    rows,
    answers,
    async findBusinessContext(id: string) {
      const b = businesses.get(id);
      return b ? { ownerId: b.ownerId, status: b.status, deletedAt: b.deletedAt } : null;
    },
    async findQuestionById(id: string) {
      return rows.get(id) ?? null;
    },
    async listByBusiness(businessId: string, page: number, pageSize: number) {
      const items = sortNewestFirst(
        [...rows.values()].filter((r) => r.businessId === businessId && r.status === 'approved'),
      );
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async listByStatus(businessId: string, status: string, page: number, pageSize: number) {
      const items = sortNewestFirst(
        [...rows.values()].filter((r) => r.businessId === businessId && r.status === status),
      );
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async listByUser(userId: string, page: number, pageSize: number) {
      const items = sortNewestFirst([...rows.values()].filter((r) => r.userId === userId));
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async insertQuestion(input: { businessId: string; userId: string; body: string }) {
      seq += 1;
      const id = `aaaaaaaa-0000-4000-8000-${seq.toString().padStart(12, '0')}`;
      const row: FakeQuestionRow = {
        id,
        businessId: input.businessId,
        userId: input.userId,
        authorName: null,
        authorUsername: usernames.get(input.userId) ?? 'asker',
        body: input.body,
        status: 'approved',
        answerId: null,
        answerUserId: null,
        answerAuthorName: null,
        answerBody: null,
        answerEditedAt: null,
        answerCreatedAt: null,
        answerUpdatedAt: null,
        editedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(id, row);
      return row;
    },
    async updateQuestion(questionId: string, body: string) {
      const row = rows.get(questionId);
      if (!row) return null;
      Object.assign(row, { body, editedAt: new Date(), updatedAt: new Date() });
      return row;
    },
    async deleteQuestion(questionId: string) {
      const had = rows.delete(questionId);
      answers.delete(questionId);
      return had;
    },
    async findAnswerByQuestion(questionId: string) {
      return answers.get(questionId) ?? null;
    },
    async upsertAnswer(input: {
      questionId: string;
      userId: string;
      body: string;
      createdAt: Date;
    }) {
      const existing = answers.get(input.questionId);
      if (!existing) {
        seq += 1;
        const row: FakeAnswerRow = {
          id: `bbbbbbbb-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
          questionId: input.questionId,
          userId: input.userId,
          authorName: 'Owner',
          body: input.body,
          editedAt: null,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        };
        answers.set(input.questionId, row);
        syncJoin(input.questionId);
        return { row, created: true };
      }
      Object.assign(existing, { body: input.body, editedAt: new Date(), updatedAt: new Date() });
      syncJoin(input.questionId);
      return { row: existing, created: false };
    },
    async deleteAnswer(questionId: string) {
      const had = answers.delete(questionId);
      syncJoin(questionId);
      return had;
    },
  };
  return repo;
}

/** The settings-repo fake (mirrors reviews.api.spec; QA itself reads no knobs). */
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

let app: INestApplication;
let redis: FakeRedis;
let qaRepo: ReturnType<typeof makeMemoryQaRepo>;
const auditActions: string[] = [];

let asker: LoginSession;
let other: LoginSession;
let owner: LoginSession;
let mod: LoginSession;

beforeAll(async () => {
  redis = new FakeRedis();
  qaRepo = makeMemoryQaRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(QA_REPOSITORY)
    .useValue(qaRepo)
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

  const askerRow = await createUser(app, { username: 'qaasker', password: 'Sup3rSecret!2026' });
  const otherRow = await createUser(app, { username: 'qaother', password: 'Sup3rSecret!2026' });
  const ownerRow = await createUser(app, { username: 'qaowner', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'qamod', password: 'Sup3rSecret!2026', role: 'moderator' });
  asker = await loginAs(app, 'qaasker', 'Sup3rSecret!2026');
  other = await loginAs(app, 'qaother', 'Sup3rSecret!2026');
  owner = await loginAs(app, 'qaowner', 'Sup3rSecret!2026');
  mod = await loginAs(app, 'qamod', 'Sup3rSecret!2026');
  usernames.set(askerRow.id, 'qaasker');
  usernames.set(otherRow.id, 'qaother');
  usernames.set(ownerRow.id, 'qaowner');
  // The DATA relationship (owner_id), not a role tag, is what authorizes answers.
  ownerId.current = ownerRow.id;
  usernames.set(ownerRow.id, 'qaowner');
  (qaRepo.businesses.get(ACTIVE) as FakeBusinessRow).ownerId = ownerRow.id;
});

afterAll(async () => {
  await app?.close();
});

const listQuestions = (businessId: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/businesses/${businessId}/questions${query}`);

const askQuestion = (businessId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/businesses/${businessId}/questions`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const patchQuestion = (questionId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/questions/${questionId}`)
    .set({ Authorization: bearer })
    .send(body);

const deleteQuestion = (questionId: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/questions/${questionId}`)
    .set({ Authorization: bearer });

const putAnswer = (questionId: string, body: object, bearer?: string) =>
  request(app.getHttpServer())
    .put(`/api/v1/questions/${questionId}/answer`)
    .set(bearer ? { Authorization: bearer } : {})
    .send(body);

const deleteAnswer = (questionId: string, bearer?: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/questions/${questionId}/answer`)
    .set(bearer ? { Authorization: bearer } : {});

const myQuestions = (bearer: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/questions/me${query}`).set({ Authorization: bearer });

const GOOD = { body: 'آیا ارسال به منطقهٔ سه دارید؟' };

/** Clear the Redis rate-limit counters (rl:* keys) — the ask limit is 10/hour. */
const resetLimiter = (): void => {
  for (const key of [...redis.store.keys()]) {
    if (key.startsWith('rl:')) redis.store.delete(key);
  }
};

beforeEach(() => {
  resetLimiter();
});

describe('POST /api/v1/businesses/:id/questions (B4.8)', () => {
  it('401 without authentication', async () => {
    const res = await askQuestion(ACTIVE, GOOD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('201 creates an approved question (envelope + echo)', async () => {
    const res = await askQuestion(ACTIVE, GOOD, asker.bearer);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.body).toBe(GOOD.body);
    expect(res.body.data.answer).toBeNull();
    expect(res.body.data.authorUsername).toBe('qaasker');
  });

  it('404s an unknown business (never leaks existence)', async () => {
    const res = await askQuestion('99999999-9999-4999-8999-999999999999', GOOD, asker.bearer);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s a soft-deleted business; 422s a non-active one', async () => {
    const deleted = await askQuestion(DELETED, GOOD, asker.bearer);
    expect(deleted.status).toBe(404);
    const pending = await askQuestion(PENDING, GOOD, asker.bearer);
    expect(pending.status).toBe(422);
    expect(pending.body.error.code).toBe('UNPROCESSABLE');
  });

  it('400 on an invalid body (too short); 422 on a non-UUID business id', async () => {
    const short = await askQuestion(ACTIVE, { body: 'کوتاه' }, asker.bearer);
    expect(short.status).toBe(400);
    const badId = await askQuestion('not-a-uuid', GOOD, asker.bearer);
    expect(badId.status).toBe(422);
  });

  it('429 after the 10th question inside the hour (fail-closed limiter)', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await askQuestion(
        ACTIVE,
        { body: `سؤال شمارهٔ ${i} دربارهٔ ارسال کالا` },
        asker.bearer,
      );
      expect(res.status).toBe(201);
    }
    const res = await askQuestion(ACTIVE, { body: 'یک سؤال دیگر پس از سقف مجاز' }, asker.bearer);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('audits question.create', async () => {
    auditActions.length = 0;
    await askQuestion(ACTIVE, GOOD, asker.bearer);
    expect(auditActions).toContain('question.create');
  });
});

describe('GET /api/v1/businesses/:id/questions (B4.8)', () => {
  it('200 public, approved-only, with the answer joined inline', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const questionId = created.body.data.id as string;
    await putAnswer(questionId, { body: 'بله، ارسال داریم.' }, owner.bearer);

    const res = await listQuestions(ACTIVE);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const item = res.body.data.items.find((q: { id: string }) => q.id === questionId);
    expect(item).toBeDefined();
    expect(item.answer).not.toBeNull();
    expect(item.answer.body).toBe('بله، ارسال داریم.');
    expect(item.answer.authorName).toBe('Owner');
  });

  it('hides a rejected question from the public list', async () => {
    const created = await askQuestion(ACTIVE, { body: 'سؤالی که بعداً رد می‌شود' }, asker.bearer);
    qaRepo.rows.get(created.body.data.id as string)!.status = 'rejected';
    const res = await listQuestions(ACTIVE);
    const ids = res.body.data.items.map((q: { id: string }) => q.id);
    expect(ids).not.toContain(created.body.data.id);
    qaRepo.rows.get(created.body.data.id as string)!.status = 'approved';
  });

  it('the ?status= moderation filter: 401 anonymous, 403 user, 200 moderator', async () => {
    const anon = await listQuestions(ACTIVE, '?status=pending');
    expect(anon.status).toBe(401);
    const plain = await listQuestions(ACTIVE, '?status=pending').set({
      Authorization: other.bearer,
    });
    expect(plain.status).toBe(403);
    const modRes = await listQuestions(ACTIVE, '?status=pending').set({
      Authorization: mod.bearer,
    });
    expect(modRes.status).toBe(200);
  });

  it('paginates with meta', async () => {
    const res = await listQuestions(ACTIVE, '?page=1&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body.data.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.body.data.items.length).toBeLessThanOrEqual(2);
  });
});

describe('PATCH /api/v1/questions/:id (B4.8)', () => {
  it('the asker edits; editedAt is stamped; others get 403', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    const ok = await patchQuestion(
      id,
      { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' },
      asker.bearer,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.body).toBe('پرسش را بازنویسی کردم؛ ارسال دارید؟');
    expect(ok.body.data.editedAt).not.toBeNull();
    const forbidden = await patchQuestion(
      id,
      { body: 'تلاش یک کاربر دیگر برای ویرایش' },
      other.bearer,
    );
    expect(forbidden.status).toBe(403);
  });

  it('404 unknown question; 400 invalid body', async () => {
    const missing = await patchQuestion(
      '99999999-9999-4999-8999-999999999999',
      { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' },
      asker.bearer,
    );
    expect(missing.status).toBe(404);
    const invalid = await patchQuestion(
      'not-a-uuid',
      { body: 'پرسش را بازنویسی کردم' },
      asker.bearer,
    );
    expect(invalid.status).toBe(422);
  });
});

describe('DELETE /api/v1/questions/:id (B4.8)', () => {
  it('the asker deletes; the answer cascades; the public list drops it', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    await putAnswer(id, { body: 'پاسخ مالک پیش از حذف پرسش.' }, owner.bearer);
    const res = await deleteQuestion(id, asker.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });
    // The answer cascaded with the question (this question's answer is gone).
    expect(qaRepo.answers.has(id)).toBe(false);
    const list = await listQuestions(ACTIVE);
    expect(list.body.data.items.map((q: { id: string }) => q.id)).not.toContain(id);
  });

  it('403 another user; 200 moderator takedown; 404 unknown', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    const forbidden = await deleteQuestion(id, other.bearer);
    expect(forbidden.status).toBe(403);
    const takedown = await deleteQuestion(id, mod.bearer);
    expect(takedown.status).toBe(200);
    expect(takedown.body.data).toEqual({ deleted: true });
    const missing = await deleteQuestion(id, asker.bearer);
    expect(missing.status).toBe(404);
  });
});

describe('PUT /api/v1/questions/:id/answer (B4.8)', () => {
  it('401 without authentication', async () => {
    const res = await putAnswer('99999999-9999-4999-8999-999999999999', { body: 'پاسخ.' });
    expect(res.status).toBe(401);
  });

  it('the owner answers (created: true) then edits in place (created: false, provenance kept)', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    const first = await putAnswer(id, { body: 'بله، ارسال داریم.' }, owner.bearer);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.data.created).toBe(true);
    expect(first.body.data.answer.userId).toBe(ownerId.current);
    const originalCreatedAt = first.body.data.answer.createdAt;

    const second = await putAnswer(id, { body: 'ارسال رایگان هم داریم.' }, owner.bearer);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.answer.id).toBe(first.body.data.answer.id);
    expect(second.body.data.answer.userId).toBe(ownerId.current);
    expect(second.body.data.answer.createdAt).toBe(originalCreatedAt);
    expect(second.body.data.answer.editedAt).not.toBeNull();
  });

  it('403 a random user and a moderator (moderation never speaks as the business)', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    const otherRes = await putAnswer(id, { body: 'تلاش کاربر دیگر برای پاسخ.' }, other.bearer);
    expect(otherRes.status).toBe(403);
    const modRes = await putAnswer(id, { body: 'تلاش ناظر برای پاسخ.' }, mod.bearer);
    expect(modRes.status).toBe(403);
  });

  it('422 a pending question; 404 unknown question', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    qaRepo.rows.get(id)!.status = 'pending';
    const res = await putAnswer(id, { body: 'پاسخ به سؤال در انتظار.' }, owner.bearer);
    expect(res.status).toBe(422);
    qaRepo.rows.get(id)!.status = 'approved';
    const missing = await putAnswer(
      '99999999-9999-4999-8999-999999999999',
      { body: 'پاسخ.' },
      owner.bearer,
    );
    expect(missing.status).toBe(404);
  });

  it('audits question.answer.upsert', async () => {
    auditActions.length = 0;
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    await putAnswer(created.body.data.id as string, { body: 'پاسخ برای ممیزی.' }, owner.bearer);
    expect(auditActions).toContain('question.answer.upsert');
  });
});

describe('DELETE /api/v1/questions/:id/answer (B4.8)', () => {
  it('idempotent when no answer exists ({ deleted: false })', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    const res = await deleteAnswer(id, owner.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: false });
  });

  it('owner removes; answer author removes after handover; 403 others', async () => {
    const created = await askQuestion(ACTIVE, GOOD, asker.bearer);
    const id = created.body.data.id as string;
    await putAnswer(id, { body: 'پاسخی که حذف می‌شود.' }, owner.bearer);
    const forbidden = await deleteAnswer(id, other.bearer);
    expect(forbidden.status).toBe(403);
    const res = await deleteAnswer(id, owner.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });

    await putAnswer(id, { body: 'پاسخ دوم برای تست نویسنده.' }, owner.bearer);
    const byAuthor = await deleteAnswer(id, owner.bearer);
    expect(byAuthor.body.data).toEqual({ deleted: true });

    await putAnswer(id, { body: 'پاسخ سوم برای تست ناظر.' }, owner.bearer);
    const takedown = await deleteAnswer(id, mod.bearer);
    expect(takedown.body.data).toEqual({ deleted: true });
  });

  it('404 unknown question', async () => {
    const res = await deleteAnswer('99999999-9999-4999-8999-999999999999', owner.bearer);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/questions/me (B4.8)', () => {
  it('lists every status of the caller’s own questions, newest first', async () => {
    const first = await askQuestion(ACTIVE, { body: 'نخستین سؤال من دربارهٔ ارسال' }, asker.bearer);
    const second = await askQuestion(
      ACTIVE,
      { body: 'دومین سؤال من دربارهٔ ساعت کاری' },
      asker.bearer,
    );
    qaRepo.rows.get(second.body.data.id as string)!.createdAt = new Date(Date.now() + 1000);
    const res = await myQuestions(asker.bearer);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((q: { id: string }) => q.id);
    expect(ids).toContain(first.body.data.id);
    expect(ids).toContain(second.body.data.id);
    // Newest first: the re-timestamped second question leads.
    expect(ids[0]).toBe(second.body.data.id);
  });

  it('401 without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/questions/me');
    expect(res.status).toBe(401);
  });
});
