import { describe, expect, it, vi } from 'vitest';
import { FraudScoreService } from '../src/modules/ai/fraud-score.service.js';
import type { AiFraudScoreRow, NewAiFraudScoreRow } from '../src/db/schema/ai-fraud-scores.js';
import type { AiFraudScoresRepositoryLike } from '../src/modules/ai/ai-fraud-scores.repository.js';
import type { AiService } from '../src/modules/ai/ai.service.js';
import type { AiCompletionResult } from '@app/contracts';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import type { CacheService } from '../src/redis/cache.service.js';
import type { ReviewsService } from '../src/modules/reviews/reviews.service.js';

/**
 * A9.6 — FraudScoreService. The moderator's score read, the moderation
 * queue (sorted DESC), the regenerate endpoint, and the actual generation
 * logic with the JSON-parse defensive path.
 */

const RID = '00000000-0000-4000-8000-0000000000r1';

function makeRow(overrides: Partial<AiFraudScoreRow> = {}): AiFraudScoreRow {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    reviewId: RID,
    score: 0.3,
    driver: 'rule',
    model: 'rule-fa-v1',
    promptVersion: 1,
    stale: false,
    signals: 'long_body',
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
    'ai.feature.faqAutoAnswerEnabled': false,
    'ai.feature.recommendationsEnabled': false,
    'ai.feature.fraudToxicityEnabled': true,
    'ai.prompts.fraudToxicity.system': 'You are a fraud classifier.',
    'ai.prompts.fraudToxicity.version': 1,
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

function makeFakeScoresRepo(initial: AiFraudScoreRow | null = null) {
  let row: AiFraudScoreRow | null = initial;
  const repo: AiFraudScoresRepositoryLike & {
    _upserts: NewAiFraudScoreRow[];
    _staleMarked: number;
  } = {
    _upserts: [],
    _staleMarked: 0,
    async findByReviewId() {
      return row;
    },
    async upsert(input: NewAiFraudScoreRow) {
      const updated: AiFraudScoreRow = {
        id: row?.id ?? '00000000-0000-4000-8000-0000000000f1',
        reviewId: input.reviewId,
        score: input.score,
        driver: input.driver,
        model: input.model ?? null,
        promptVersion: input.promptVersion ?? 1,
        stale: false,
        signals: input.signals ?? null,
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
        lastError: input.lastError ?? null,
        createdAt: row?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      row = updated;
      (this as { _upserts: NewAiFraudScoreRow[] })._upserts.push(input);
      return updated;
    },
    async markStale() {
      (this as { _staleMarked: number })._staleMarked++;
      return;
    },
    async listQueue(_minScore: number, _limit: number, _offset: number) {
      return { rows: [], total: 0 };
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
      text: JSON.stringify({ score: 0.7, signals: ['long_body', 'all_caps'] }),
      promptTokens: 15,
      completionTokens: 5,
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

function makeFakeReviews(
  review: { id: string; body: string } | null = { id: RID, body: 'یک نظر' },
) {
  return {
    findByIdForAi: async () => review,
  } as unknown as ReviewsService;
}

function makeService(
  opts: {
    settings?: Record<string, unknown>;
    initialRow?: AiFraudScoreRow | null;
    review?: { id: string; body: string } | null;
    aiResult?: Partial<AiCompletionResult>;
  } = {},
) {
  const settings = makeFakeSettings(makeSettingsMap(opts.settings ?? {}));
  const cache = makeFakeCache();
  const scoresRepo = makeFakeScoresRepo(opts.initialRow ?? null);
  const ai = makeFakeAi(opts.aiResult ?? {});
  const reviews = makeFakeReviews(opts.review);
  const service = new FraudScoreService(settings, cache, scoresRepo, ai, reviews);
  return { service, settings, cache, scoresRepo, ai, reviews };
}

describe('FraudScoreService.getScore (A9.6)', () => {
  it('returns null + enqueues an initial generate when no score exists', async () => {
    const { service, scoresRepo } = makeService();
    const score = await service.getScore(RID);
    expect(score).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(scoresRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the existing score', async () => {
    const { service } = makeService({ initialRow: makeRow({ score: 0.8 }) });
    const score = await service.getScore(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0.8);
  });

  it('marks stale + enqueues a regenerate on prompt-version mismatch', async () => {
    const { service, scoresRepo } = makeService({
      initialRow: makeRow({ promptVersion: 1 }),
      settings: { 'ai.prompts.fraudToxicity.version': 2 },
    });
    const score = await service.getScore(RID);
    expect(score).not.toBeNull();
    expect(score!.stale).toBe(true);
    expect(scoresRepo._staleMarked).toBeGreaterThanOrEqual(1);
  });
});

describe('FraudScoreService.regenerate (A9.6)', () => {
  it('enqueues a regenerate and returns enqueued=true', async () => {
    const { service, scoresRepo } = makeService();
    const result = await service.regenerate(RID);
    expect(result.enqueued).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(scoresRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FraudScoreService.onReviewChanged (A9.6)', () => {
  it('enqueues an initial generate when no row exists', async () => {
    const { service, scoresRepo } = makeService();
    await service.onReviewChanged(RID);
    await new Promise((r) => setTimeout(r, 50));
    expect(scoresRepo._upserts.length).toBeGreaterThanOrEqual(1);
  });

  it('marks stale when a row exists', async () => {
    const { service, scoresRepo } = makeService({ initialRow: makeRow() });
    await service.onReviewChanged(RID);
    expect(scoresRepo._staleMarked).toBeGreaterThanOrEqual(1);
  });
});

describe('FraudScoreService.generateForReview (A9.6)', () => {
  it('returns null when the review does not exist', async () => {
    const { service } = makeService({ review: null });
    const result = await service.generateForReview(RID);
    expect(result).toBeNull();
  });

  it('parses the JSON score + signals + upserts the row', async () => {
    const { service, scoresRepo } = makeService({
      aiResult: { text: JSON.stringify({ score: 0.85, signals: ['long_body', 'blocked_word'] }) },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0.85);
    expect(score!.signals).toBe('long_body,blocked_word');
    expect(score!.driver).toBe('rule');
    expect(scoresRepo._upserts).toHaveLength(1);
  });

  it('parses JSON wrapped in markdown fences', async () => {
    const { service } = makeService({
      aiResult: { text: '```json\n{"score": 0.5, "signals": ["all_caps"]}\n```' },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0.5);
    expect(score!.signals).toBe('all_caps');
  });

  it('defaults to score=0 + signals=null on a malformed JSON response', async () => {
    const { service } = makeService({
      aiResult: { text: 'not json at all' },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0);
    expect(score!.signals).toBeNull();
  });

  it('defaults to score=0 + stores the error code on AI failure', async () => {
    const { service } = makeService({
      aiResult: { ok: false, text: null, errorCode: 'AI_DISABLED', errorMessage: 'disabled' },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0);
    expect(score!.lastError).toBe('AI_DISABLED');
  });

  it('clamps an out-of-range score to 0', async () => {
    const { service } = makeService({
      aiResult: { text: JSON.stringify({ score: 1.5, signals: [] }) },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0);
    expect(score!.signals).toBeNull();
  });

  it('accepts a score of 0 (benign)', async () => {
    const { service } = makeService({
      aiResult: { text: JSON.stringify({ score: 0, signals: [] }) },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(0);
    expect(score!.signals).toBeNull();
  });

  it('accepts a score of 1 (high-risk)', async () => {
    const { service } = makeService({
      aiResult: { text: JSON.stringify({ score: 1, signals: ['blocked_word'] }) },
    });
    const score = await service.generateForReview(RID);
    expect(score).not.toBeNull();
    expect(score!.score).toBe(1);
    expect(score!.signals).toBe('blocked_word');
  });
});

describe('FraudScoreService.listQueue (A9.6)', () => {
  it('returns the paginated queue', async () => {
    const settings = makeFakeSettings(makeSettingsMap());
    const cache = makeFakeCache();
    const scoresRepo: AiFraudScoresRepositoryLike = {
      async findByReviewId() {
        return null;
      },
      async upsert() {
        return {} as AiFraudScoreRow;
      },
      async markStale() {
        return;
      },
      async listQueue(_minScore: number, _limit: number, _offset: number) {
        return {
          rows: [
            {
              reviewId: RID,
              businessId: '00000000-0000-4000-8000-0000000000b1',
              businessName: 'کافه نمونه',
              userId: '00000000-0000-4000-8000-0000000000u1',
              userUsername: 'user1',
              rating: 1,
              body: 'خیلی بد بود!!!',
              reviewStatus: 'approved',
              score: 0.9,
              signals: 'all_caps,repeated_punctuation',
              scoreUpdatedAt: new Date(),
              reviewCreatedAt: new Date(),
            },
          ],
          total: 1,
        };
      },
    };
    const ai = makeFakeAi();
    const reviews = makeFakeReviews();
    const service = new FraudScoreService(settings, cache, scoresRepo, ai, reviews);

    // Spy on listQueue to verify the call.
    const spy = vi.spyOn(scoresRepo, 'listQueue');
    const result = await service.listQueue({ page: 1, pageSize: 20, minScore: 0.5 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.score).toBe(0.9);
    expect(result.items[0]!.businessName).toBe('کافه نمونه');
    expect(result.total).toBe(1);
    expect(spy).toHaveBeenCalledWith(0.5, 20, 0);
  });

  it('defaults minScore to 0.5 when not provided', async () => {
    const settings = makeFakeSettings(makeSettingsMap());
    const cache = makeFakeCache();
    const scoresRepo: AiFraudScoresRepositoryLike = {
      async findByReviewId() {
        return null;
      },
      async upsert() {
        return {} as AiFraudScoreRow;
      },
      async markStale() {
        return;
      },
      async listQueue() {
        return { rows: [], total: 0 };
      },
    };
    const ai = makeFakeAi();
    const reviews = makeFakeReviews();
    const service = new FraudScoreService(settings, cache, scoresRepo, ai, reviews);

    const spy = vi.spyOn(scoresRepo, 'listQueue');
    await service.listQueue({});
    expect(spy).toHaveBeenCalledWith(0.5, 20, 0);
  });
});
