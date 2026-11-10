import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { QaService, QA_EVENTS } from '../src/modules/qa/qa.service.js';
import type {
  QaAnswerWithMeta,
  QaQuestionWithMeta,
  QaRepositoryLike,
} from '../src/modules/qa/qa.repository.js';
import type { QaStatus } from '@app/contracts';

/**
 * B4.8 QaService — the business rules, DB-free: the active-only gate, NO
 * one-question-per-user rule (multiple questions allowed, rate limit is the
 * HTTP layer's job), asker-only edits, asker-or-moderator deletes, the
 * approved-only answer gate, owner/manage-only answers, one-answer-per-
 * question upsert semantics and the event emissions. The repository SQL
 * (unique index upsert, pagination, cascades) is integration-tested against
 * Docker per the Follow-up.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const ALICE = { id: '22222222-2222-4222-8222-222222222222', role: 'user' };
const BOB = { id: '33333333-3333-4333-8333-333333333333', role: 'user' };
const ADMIN = { id: '44444444-4444-4444-8444-444444444444', role: 'admin' };
const MODERATOR = { id: '47474747-4747-4747-8474-474747474747', role: 'moderator' };
/** The business's owner — matched by `owner_id`, not the role tag. */
const OWNER = { id: '88888880-8888-4888-8888-888888888880', role: 'user' };

const PENDING_BIZ = '15151515-1515-4151-8151-151515151515';
const DELETED_BIZ = '13131313-1313-4131-8131-131313131313';
const Q1 = '55555555-5555-4555-8555-555555555555';
const Q2 = '56565656-5656-4656-8656-565656565656';

function questionRow(overrides: Partial<QaQuestionWithMeta> = {}): QaQuestionWithMeta {
  return {
    id: Q1,
    businessId: BIZ,
    userId: ALICE.id,
    authorName: null,
    authorUsername: 'alice',
    body: 'آیا ارسال به منطقهٔ سه دارید؟',
    status: 'approved' as QaStatus,
    answerId: null,
    answerUserId: null,
    answerAuthorName: null,
    answerBody: null,
    answerEditedAt: null,
    answerCreatedAt: null,
    answerUpdatedAt: null,
    editedAt: null,
    createdAt: new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  };
}

function answerRow(overrides: Partial<QaAnswerWithMeta> = {}): QaAnswerWithMeta {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    questionId: Q1,
    userId: OWNER.id,
    authorName: 'Owner',
    body: 'بله، ارسال داریم.',
    editedAt: null,
    createdAt: new Date('2026-11-10T11:00:00Z'),
    updatedAt: new Date('2026-11-10T11:00:00Z'),
    ...overrides,
  };
}

/** In-memory repo mirroring the SQL semantics the service relies on. */
function makeRepo(
  initial: QaQuestionWithMeta[] = [],
  businesses?: Map<string, { ownerId: string | null; status: string; deletedAt: Date | null }>,
) {
  const rows = new Map(initial.map((r) => [r.id, r]));
  const biz = new Map<string, { ownerId: string | null; status: string; deletedAt: Date | null }>(
    businesses ?? [
      [BIZ, { ownerId: OWNER.id, status: 'active', deletedAt: null }],
      [PENDING_BIZ, { ownerId: OWNER.id, status: 'pending', deletedAt: null }],
      [DELETED_BIZ, { ownerId: OWNER.id, status: 'active', deletedAt: new Date() }],
    ],
  );
  const answers = new Map<string, QaAnswerWithMeta>();
  let seq = 0;
  /** The real repo LEFT JOINs the answer onto the question — the fake syncs it. */
  const syncJoin = (questionId: string) => {
    const q = rows.get(questionId);
    const a = answers.get(questionId);
    if (!q) return;
    if (a) {
      Object.assign(q, {
        answerId: a.id,
        answerUserId: a.userId,
        answerAuthorName: a.authorName,
        answerBody: a.body,
        answerEditedAt: a.editedAt,
        answerCreatedAt: a.createdAt,
        answerUpdatedAt: a.updatedAt,
      });
    } else {
      Object.assign(q, {
        answerId: null,
        answerUserId: null,
        answerAuthorName: null,
        answerBody: null,
        answerEditedAt: null,
        answerCreatedAt: null,
        answerUpdatedAt: null,
      });
    }
  };
  const repo = {
    async findBusinessContext(businessId: string) {
      return biz.get(businessId) ?? null;
    },
    async findQuestionById(questionId: string) {
      const row = rows.get(questionId);
      return row ? { ...row } : null;
    },
    async listByBusiness(businessId: string, page: number, pageSize: number) {
      const items = [...rows.values()]
        .filter((r) => r.businessId === businessId && r.status === 'approved')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice((page - 1) * pageSize, page * pageSize)
        .map((r) => ({ ...r }));
      return { items, total: items.length };
    },
    async listByStatus(businessId: string, status: QaStatus, page: number, pageSize: number) {
      const filtered = [...rows.values()].filter(
        (r) => r.businessId === businessId && r.status === status,
      );
      const items = filtered
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice((page - 1) * pageSize, page * pageSize)
        .map((r) => ({ ...r }));
      return { items, total: filtered.length };
    },
    async listByUser(userId: string, page: number, pageSize: number) {
      const filtered = [...rows.values()].filter((r) => r.userId === userId);
      const items = filtered
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice((page - 1) * pageSize, page * pageSize)
        .map((r) => ({ ...r }));
      return { items, total: filtered.length };
    },
    async insertQuestion(input: { businessId: string; userId: string; body: string }) {
      seq += 1;
      const row = questionRow({
        id: `77777777-0000-4000-8000-00000000000${seq}`,
        businessId: input.businessId,
        userId: input.userId,
        body: input.body,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      rows.set(row.id, row);
      return { ...row };
    },
    async updateQuestion(questionId: string, body: string) {
      const row = rows.get(questionId);
      if (!row) return null;
      Object.assign(row, { body, editedAt: new Date(), updatedAt: new Date() });
      return { ...row };
    },
    async deleteQuestion(questionId: string) {
      const had = rows.delete(questionId);
      answers.delete(questionId);
      return had;
    },
    async findAnswerByQuestion(questionId: string) {
      const a = answers.get(questionId);
      return a ? { ...a } : null;
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
        const row = answerRow({
          id: `88888888-0000-4000-8000-00000000000${seq}`,
          questionId: input.questionId,
          userId: input.userId,
          body: input.body,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        });
        answers.set(input.questionId, row);
        syncJoin(input.questionId);
        return { row: { ...row }, created: true };
      }
      Object.assign(existing, { body: input.body, editedAt: new Date(), updatedAt: new Date() });
      syncJoin(input.questionId);
      return { row: { ...existing }, created: false };
    },
    async deleteAnswer(questionId: string) {
      const had = answers.delete(questionId);
      syncJoin(questionId);
      return had;
    },
  };
  return { repo, rows, answers, biz };
}

function makeService(repo = makeRepo()) {
  const events = { emit: vi.fn() };
  const svc = new QaService(repo.repo as QaRepositoryLike, events as never);
  return { svc, events, ...repo };
}

const QUESTION_BODY = 'آیا ارسال به منطقهٔ سه دارید؟';
const ASK = { body: QUESTION_BODY };
const ANSWER = { body: 'بله، ارسال داریم.' };

function expectHttp(fn: () => Promise<unknown>, status: number): Promise<HttpException> {
  return fn().then(
    () => {
      throw new Error('expected the call to reject');
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(status);
      return e as HttpException;
    },
  );
}

describe('QaService.create (B4.8)', () => {
  it('creates an approved question and emits question.created', async () => {
    const { svc, events } = makeService();
    const q = await svc.create(BIZ, ALICE, ASK);
    expect(q.status).toBe('approved');
    expect(q.body).toBe(QUESTION_BODY);
    expect(q.answer).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(QA_EVENTS.created, expect.anything());
  });

  it('allows the SAME user to ask several questions (no one-per-user rule)', async () => {
    const { svc } = makeService();
    const first = await svc.create(BIZ, ALICE, ASK);
    const second = await svc.create(BIZ, ALICE, {
      body: 'سؤال دیگری دربارهٔ ساعت کاری دارم.',
    });
    expect(first.id).not.toBe(second.id);
  });

  it('404s a business that does not exist (never leaks)', async () => {
    const { svc } = makeService();
    await expectHttp(() => svc.create('99999999-9999-4999-8999-999999999999', ALICE, ASK), 404);
  });

  it('404s a soft-deleted business (404-never-leak)', async () => {
    const { svc } = makeService();
    await expectHttp(() => svc.create(DELETED_BIZ, ALICE, ASK), 404);
  });

  it('422s a non-active business', async () => {
    const { svc } = makeService();
    await expectHttp(() => svc.create(PENDING_BIZ, ALICE, ASK), 422);
  });
});

describe('QaService.update / remove (B4.8)', () => {
  it('lets the asker edit and stamps edited_at + emits question.updated', async () => {
    const { svc, events } = makeService(makeRepo([questionRow()]));
    const q = await svc.update(Q1, ALICE, { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' });
    expect(q.body).toBe('پرسش را بازنویسی کردم؛ ارسال دارید؟');
    expect(q.editedAt).not.toBeNull();
    expect(events.emit).toHaveBeenCalledWith(QA_EVENTS.updated, expect.anything());
  });

  it('rejects an edit by anyone but the asker (403)', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    await expectHttp(
      () => svc.update(Q1, BOB, { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' }),
      403,
    );
    await expectHttp(
      () => svc.update(Q1, OWNER, { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' }),
      403,
    );
    await expectHttp(
      () => svc.update(Q1, ADMIN, { body: 'پرسش را بازنویسی کردم؛ ارسال دارید؟' }),
      403,
    );
  });

  it('lets the asker delete; the answer cascades with the question', async () => {
    const { svc, events, answers } = makeService(makeRepo([questionRow()]));
    await svc.upsertAnswer(Q1, OWNER, ANSWER);
    expect(answers.size).toBe(1);
    const result = await svc.remove(Q1, ALICE);
    expect(result).toEqual({ deleted: true });
    expect(answers.size).toBe(0);
    expect(eventsEmitted(events).deleted).toBe(true);
  });

  it('lets a moderator takedown any question but forbids another user (403)', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    await expectHttp(() => svc.remove(Q1, BOB), 403);
    const result = await svc.remove(Q1, MODERATOR);
    expect(result).toEqual({ deleted: true });
  });

  it('404s an unknown question', async () => {
    const { svc } = makeService();
    await expectHttp(() => svc.remove(Q1, ALICE), 404);
  });
});

describe('QaService.upsertAnswer (B4.8)', () => {
  it('the owner answers; the question is served with the answer inline', async () => {
    const { svc, events } = makeService(makeRepo([questionRow()]));
    const { answer, created } = await svc.upsertAnswer(Q1, OWNER, ANSWER);
    expect(created).toBe(true);
    expect(answer.userId).toBe(OWNER.id);
    const page = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    expect(page.items[0]?.answer?.body).toBe(ANSWER.body);
    expect(events.emit).toHaveBeenCalledWith(QA_EVENTS.answered, expect.anything());
  });

  it('a businesses.manage holder (admin) may answer too', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    const { created } = await svc.upsertAnswer(Q1, ADMIN, ANSWER);
    expect(created).toBe(true);
  });

  it('a second PUT by the (transferred) owner EDITS in place, keeping provenance', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    const first = await svc.upsertAnswer(Q1, OWNER, ANSWER);
    const second = await svc.upsertAnswer(Q1, ADMIN, { body: 'ارسال رایگان هم داریم.' });
    expect(second.created).toBe(false);
    expect(second.answer.id).toBe(first.answer.id);
    expect(second.answer.userId).toBe(OWNER.id); // provenance never changes
    expect(second.answer.body).toBe('ارسال رایگان هم داریم.');
    expect(second.answer.editedAt).not.toBeNull();
    expect(second.answer.createdAt).toBe(first.answer.createdAt);
  });

  it('422s an answer to a pending question', async () => {
    const { svc } = makeService(makeRepo([questionRow({ status: 'pending' })]));
    await expectHttp(() => svc.upsertAnswer(Q1, OWNER, ANSWER), 422);
  });

  it('403s a random user (moderation moderates, it never speaks as the business)', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    await expectHttp(() => svc.upsertAnswer(Q1, BOB, ANSWER), 403);
    await expectHttp(() => svc.upsertAnswer(Q1, MODERATOR, ANSWER), 403);
    await expectHttp(() => svc.upsertAnswer(Q1, ALICE, ANSWER), 403);
  });

  it('404s an unknown question', async () => {
    const { svc } = makeService();
    await expectHttp(() => svc.upsertAnswer(Q1, OWNER, ANSWER), 404);
  });
});

describe('QaService.removeAnswer (B4.8)', () => {
  it('owner, answer author and moderator may remove; others 403', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    await svc.upsertAnswer(Q1, OWNER, ANSWER);
    await expectHttp(() => svc.removeAnswer(Q1, BOB), 403);
    expect((await svc.removeAnswer(Q1, MODERATOR)).deleted).toBe(true);
  });

  it('the answer author may remove their own answer after a handover', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    await svc.upsertAnswer(Q1, OWNER, ANSWER);
    expect((await svc.removeAnswer(Q1, OWNER)).deleted).toBe(true);
  });

  it('is idempotent when no answer exists ({ deleted: false }), but an unknown question is 404', async () => {
    const { svc } = makeService(makeRepo([questionRow()]));
    expect(await svc.removeAnswer(Q1, OWNER)).toEqual({ deleted: false });
    // Idempotency does not erase the 404 rule — an unknown QUESTION still 404s.
    await expectHttp(() => svc.removeAnswer(Q2, OWNER), 404);
  });
});

describe('QaService.listMine (B4.8)', () => {
  it('returns every status of the caller’s own questions, newest first', async () => {
    const { svc } = makeService(
      makeRepo([
        questionRow({ id: Q1, userId: ALICE.id }),
        questionRow({
          id: Q2,
          userId: ALICE.id,
          status: 'pending',
          createdAt: new Date('2026-11-11T09:00:00Z'),
        }),
        questionRow({ id: '57575757-5757-4757-8757-575757575757', userId: BOB.id }),
      ]),
    );
    const page = await svc.listMine(ALICE.id, { page: 1, pageSize: 20 });
    expect(page.meta.total).toBe(2);
    expect(page.items.map((q) => q.id)).toEqual([Q2, Q1]);
  });

  it('the public list serves approved questions only', async () => {
    const { svc } = makeService(
      makeRepo([questionRow({ id: Q1 }), questionRow({ id: Q2, status: 'rejected' })]),
    );
    const page = await svc.listByBusiness(BIZ, { page: 1, pageSize: 20 });
    expect(page.meta.total).toBe(1);
    expect(page.items[0]?.id).toBe(Q1);
  });
});

/** Small helper — did the service emit the given event at least once? */
function eventsEmitted(events: { emit: ReturnType<typeof vi.fn> }): Record<string, boolean> {
  const calls = events.emit.mock.calls.map((c) => c[0] as string);
  return {
    created: calls.includes(QA_EVENTS.created),
    updated: calls.includes(QA_EVENTS.updated),
    deleted: calls.includes(QA_EVENTS.deleted),
    answered: calls.includes(QA_EVENTS.answered),
  };
}
