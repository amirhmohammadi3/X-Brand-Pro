import { describe, expect, it, vi } from 'vitest';
import {
  FaqAnswerService,
  FaqDraftNotReadyError,
  FaqDraftDismissedError,
} from '../src/modules/ai/faq-answer.service.js';
import type { AiFaqAnswerRow, NewAiFaqAnswerRow } from '../src/db/schema/ai-faq-answers.js';
import type { AiFaqAnswersRepositoryLike } from '../src/modules/ai/ai-faq-answers.repository.js';
import type { AiService } from '../src/modules/ai/ai.service.js';
import type { AiCompletionResult } from '@app/contracts';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import type { CacheService } from '../src/redis/cache.service.js';
import type { QaService } from '../src/modules/qa/qa.service.js';
import type { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import type { BusinessActor } from '../src/modules/business/business-access.js';

/**
 * A9.4 — FaqAnswerService. The owner's draft read, the publish flow
 * (calls QaService.upsertAnswer), the dismiss flow, the regenerate
 * endpoint, and the actual generation logic.
 */

const QID = '00000000-0000-4000-8000-0000000000q1';
const BIZ = '00000000-0000-4000-8000-0000000000b1';
const AID = '00000000-0000-4000-8000-0000000000a1';

function makeRow(overrides: Partial<AiFaqAnswerRow> = {}): AiFaqAnswerRow {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    questionId: QID,
    draft: 'پاسخ آزمایشی.',
    driver: 'rule',
    model: 'rule-fa-v1',
    promptVersion: 1,
    published: false,
    dismissed: false,
    stale: false,
    promptTokens: 10,
    completionTokens: 5,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSettingsMap(overrides: Record<string, unknown> = {}) {
  return {
    'ai.enabled': true,
    'ai.driver': 'rule',
    'ai.openai.baseUrl': 'https://api.openai.com/v1',
    'ai.openai.apiKey': '',
    'ai.openai.model': 'gpt-4o-mini',
    'ai.timeoutMs': 5000,
    'ai.maxRetries': 2,
    'ai.monthlyBudgetTokens': 1_000_000,
    'ai.feature.reviewSummaryEnabled': false,
    'ai.feature.faqAutoAnswerEnabled': true,
    'ai.feature.recommendationsEnabled': false,
    'ai.feature.fraudToxicityEnabled': false,
    'ai.prompts.faqAnswer.system': 'You are a Persian FAQ answerer.',
    'ai.prompts.faqAnswer.version': 1,
    ...overrides,
  } as Record<string, unknown>;
}

function makeFakeSettings(map: Record<string, unknown>) {
  return {
    get<T>(key: string): Promise<T> {
      return Promise.resolve(map[key] as T);
    },
  } as unknown as SettingsService;
}

function makeFakeCache() {
  const store = new Map<string, unknown>();
  const cache = {
    get<T>(key: string): Promise<T | null> {
      return Promise.resolve((store.get(key) as T) ?? null);
    },
    set(key: string, value: unknown): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    del(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    _store: store,
  };
  return cache as unknown as CacheService & { _store: Map<string, unknown> };
}

function makeFakeDraftsRepo(initial: AiFaqAnswerRow | null = null) {
  let row: AiFaqAnswerRow | null = initial;
  const repo: AiFaqAnswersRepositoryLike & {
    _upserts: NewAiFaqAnswerRow[];
    _published: boolean;
    _dismissed: boolean;
    _staleMarked: number;
  } = {
    _upserts: [],
    _published: initial?.published ?? false,
    _dismissed: initial?.dismissed ?? false,
    _staleMarked: 0,
    async findByQuestionId() {
      return row;
    },
    async upsert(input: NewAiFaqAnswerRow) {
      const updated: AiFaqAnswerRow = {
        id: row?.id ?? '00000000-0000-4000-8000-0000000000f1',
        questionId: input.questionId,
        draft: input.draft,
        driver: input.driver,
        model: input.model ?? null,
        promptVersion: input.promptVersion ?? 1,
        published: row?.published ?? false,
        dismissed: row?.dismissed ?? false,
        stale: false,
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
        lastError: input.lastError ?? null,
        createdAt: row?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      row = updated;
      (this as { _upserts: NewAiFaqAnswerRow[] })._upserts.push(input);
      return updated;
    },
    async markStale() {
      (this as { _staleMarked: number })._staleMarked++;
      return;
    },
    async markPublished() {
      (this as { _published: boolean })._published = true;
      if (row) row.published = true;
      return;
    },
    async markDismissed() {
      (this as { _dismissed: boolean })._dismissed = true;
      if (row) row.dismissed = true;
      return;
    },
    async listReviewQueue() {
      return row ? [row] : [];
    },
  };
  return repo;
}

function makeFakeAi(result: Partial<AiCompletionResult> = {}): AiService {
  return {
    complete: async () => ({
      ok: true,
      driver: 'rule',
      model: 'rule-fa-v1',
      text: 'پاسخ AI',
      promptTokens: 20,
      completionTokens: 10,
      latencyMs: 1,
      errorCode: null,
      errorMessage: null,
      ...result,
    }),
    test: async () => ({
      ok: true,
      driver: 'rule',
      model: 'rule-fa-v1',
      text: 'hi',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      errorCode: null,
      errorMessage: null,
      prompt: '',
    }),
    getConfig: async () => ({}) as never,
    listCalls: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
  } as unknown as AiService;
}

function makeFakeQa(
  question: {
    id: string;
    businessId: string;
    body: string;
    status: 'approved' | 'pending' | 'rejected';
  } | null = { id: QID, businessId: BIZ, body: 'سوال؟', status: 'approved' },
) {
  return {
    findQuestionForAi: async () => question,
    findAnswerForQuestion: async () => null,
    upsertAnswer: async () => ({ answer: { id: AID, body: 'پاسخ AI' }, created: true }),
  } as unknown as QaService;
}

function makeFakeReviews(items: Array<{ rating: number; body: string }> = []) {
  return {
    listForSummary: async () => ({ items, total: items.length }),
  } as unknown as ReviewsService;
}

function makeService(
  opts: {
    settings?: Record<string, unknown>;
    initialRow?: AiFaqAnswerRow | null;
    question?: {
      id: string;
      businessId: string;
      body: string;
      status: 'approved' | 'pending' | 'rejected';
    } | null;
    reviews?: Array<{ rating: number; body: string }>;
    aiResult?: Partial<AiCompletionResult>;
  } = {},
) {
  const settings = makeFakeSettings(makeSettingsMap(opts.settings ?? {}));
  const cache = makeFakeCache();
  const draftsRepo = makeFakeDraftsRepo(opts.initialRow ?? null);
  const ai = makeFakeAi(opts.aiResult ?? {});
  const qa = makeFakeQa(opts.question);
  const reviews = makeFakeReviews(opts.reviews ?? []);
  const service = new FaqAnswerService(settings, cache, draftsRepo, ai, qa, reviews);
  return { service, settings, cache, draftsRepo, ai, qa, reviews };
}

const OWNER: BusinessActor = {
  id: '00000000-0000-4000-8000-0000000000u1',
  role: 'business_owner',
  status: 'active',
} as BusinessActor;

describe('FaqAnswerService.getDraft (A9.4)', () => {
  it('returns null + enqueues an initial generate when no draft exists', async () => {
    const { service, draftsRepo } = makeService();
    const draft = await service.getDraft(BIZ, QID);
    expect(draft).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(draftsRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the existing draft', async () => {
    const { service } = makeService({ initialRow: makeRow({ draft: 'پاسخ موجود' }) });
    const draft = await service.getDraft(BIZ, QID);
    expect(draft).not.toBeNull();
    expect(draft!.draft).toBe('پاسخ موجود');
  });

  it('marks stale + enqueues a regenerate on prompt-version mismatch', async () => {
    const { service, draftsRepo } = makeService({
      initialRow: makeRow({ promptVersion: 1 }),
      settings: { 'ai.prompts.faqAnswer.version': 2 },
    });
    const draft = await service.getDraft(BIZ, QID);
    expect(draft).not.toBeNull();
    expect(draft!.stale).toBe(true);
    expect(draftsRepo._staleMarked).toBeGreaterThanOrEqual(1);
  });
});

describe('FaqAnswerService.publish (A9.4)', () => {
  it('throws FaqDraftNotReadyError when no draft exists', async () => {
    const { service } = makeService({ initialRow: null });
    await expect(service.publish(BIZ, QID, OWNER)).rejects.toBeInstanceOf(FaqDraftNotReadyError);
  });

  it('throws FaqDraftDismissedError when the draft was dismissed', async () => {
    const { service } = makeService({ initialRow: makeRow({ dismissed: true }) });
    await expect(service.publish(BIZ, QID, OWNER)).rejects.toBeInstanceOf(FaqDraftDismissedError);
  });

  it('publishes the draft via QaService.upsertAnswer + marks published', async () => {
    const { service, draftsRepo, qa } = makeService({
      initialRow: makeRow({ draft: 'پاسخ نهایی' }),
    });
    const upsertSpy = (qa.upsertAnswer = vi
      .fn()
      .mockResolvedValue({ answer: { id: AID, body: 'پاسخ نهایی' }, created: true }));
    const result = await service.publish(BIZ, QID, OWNER);
    expect(result.answerId).toBe(AID);
    expect(result.text).toBe('پاسخ نهایی');
    expect(result.created).toBe(true);
    expect(upsertSpy).toHaveBeenCalledWith(QID, OWNER, { body: 'پاسخ نهایی' });
    expect(draftsRepo._published).toBe(true);
  });

  it('returns the existing answer (created=false) when already published', async () => {
    const { service, qa } = makeService({ initialRow: makeRow({ published: true }) });
    qa.findAnswerForQuestion = async () => ({ id: AID, body: 'existing' });
    const result = await service.publish(BIZ, QID, OWNER);
    expect(result.created).toBe(false);
    expect(result.answerId).toBe(AID);
  });
});

describe('FaqAnswerService.dismiss (A9.4)', () => {
  it('marks the draft as dismissed', async () => {
    const { service, draftsRepo } = makeService({ initialRow: makeRow() });
    const result = await service.dismiss(BIZ, QID);
    expect(result.dismissed).toBe(true);
    expect(draftsRepo._dismissed).toBe(true);
  });
});

describe('FaqAnswerService.regenerate (A9.4)', () => {
  it('enqueues a regenerate and returns enqueued=true', async () => {
    const { service, draftsRepo } = makeService();
    const result = await service.regenerate(BIZ, QID);
    expect(result.enqueued).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(draftsRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FaqAnswerService.onQuestionCreated/Updated (A9.4)', () => {
  it('onQuestionCreated enqueues an initial generate', async () => {
    const { service, draftsRepo } = makeService();
    await service.onQuestionCreated(BIZ, QID);
    await new Promise((r) => setTimeout(r, 50));
    expect(draftsRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });

  it('onQuestionUpdated marks the draft stale', async () => {
    const { service, draftsRepo } = makeService({ initialRow: makeRow() });
    await service.onQuestionUpdated(BIZ, QID);
    expect(draftsRepo._staleMarked).toBeGreaterThanOrEqual(1);
  });
});

describe('FaqAnswerService.generateForQuestion (A9.4)', () => {
  it('returns null when the question does not exist', async () => {
    const { service } = makeService({ question: null });
    const result = await service.generateForQuestion(BIZ, QID);
    expect(result).toBeNull();
  });

  it('returns null when the question is not approved', async () => {
    const { service } = makeService({
      question: { id: QID, businessId: BIZ, body: 'x', status: 'pending' },
    });
    const result = await service.generateForQuestion(BIZ, QID);
    expect(result).toBeNull();
  });

  it('builds the prompt with the question + reviews + upserts the draft', async () => {
    const { service, draftsRepo } = makeService({
      reviews: [{ rating: 5, body: 'عالی' }],
      aiResult: { text: 'پاسخ هوشمند', promptTokens: 30, completionTokens: 15 },
    });
    const draft = await service.generateForQuestion(BIZ, QID);
    expect(draft).not.toBeNull();
    expect(draft!.draft).toBe('پاسخ هوشمند');
    expect(draft!.driver).toBe('rule');
    expect(draft!.promptTokens).toBe(30);
    expect(draft!.completionTokens).toBe(15);
    expect(draftsRepo._upserts).toHaveLength(1);
  });

  it('stores the error code on AI failure (keeps the placeholder text)', async () => {
    const { service } = makeService({
      aiResult: { ok: false, text: null, errorCode: 'AI_DISABLED', errorMessage: 'disabled' },
    });
    const draft = await service.generateForQuestion(BIZ, QID);
    expect(draft).not.toBeNull();
    expect(draft!.lastError).toBe('AI_DISABLED');
    expect(draft!.draft).toMatch(/در دسترس نیست/);
  });
});
