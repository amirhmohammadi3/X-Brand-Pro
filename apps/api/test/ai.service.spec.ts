import { beforeEach, describe, expect, it } from 'vitest';
import { AiService } from '../src/modules/ai/ai.service.js';
import { FakeAiDriver } from '../src/modules/ai/fake-ai.driver.js';
import { OpenAiDriver } from '../src/modules/ai/openai-ai.driver.js';
import { RuleAiDriver } from '../src/modules/ai/rule-ai.driver.js';
import type { AiCallsRepositoryLike } from '../src/modules/ai/ai-calls.repository.js';
import type { AiCompletionRequest, AiDriverName, AiErrorCode } from '@app/contracts';
import type {
  AiCallRow as AiCallDbRow,
  NewAiCallRow as NewAiCallDbRow,
} from '../src/db/schema/ai.js';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import type { CacheService } from '../src/redis/cache.service.js';

/**
 * A9.1 — AiService orchestration. The feature-flag gate, the budget gate,
 * the retry loop on the openai driver, the rule fallback, and the call
 * logging. The service is constructed with fakes for the settings / cache
 * / repo / drivers so the test is pure (no DB, no Redis, no network).
 */

interface SettingsMap {
  'ai.enabled': boolean;
  'ai.driver': AiDriverName;
  'ai.openai.baseUrl': string;
  'ai.openai.apiKey': string;
  'ai.openai.model': string;
  'ai.timeoutMs': number;
  'ai.maxRetries': number;
  'ai.monthlyBudgetTokens': number;
  'ai.feature.reviewSummaryEnabled': boolean;
  'ai.feature.faqAutoAnswerEnabled': boolean;
  'ai.feature.recommendationsEnabled': boolean;
  'ai.feature.fraudToxicityEnabled': boolean;
}

function makeSettings(overrides: Partial<SettingsMap> = {}): SettingsMap {
  return {
    'ai.enabled': true,
    'ai.driver': 'fake',
    'ai.openai.baseUrl': 'https://api.openai.com/v1',
    'ai.openai.apiKey': 'sk-test',
    'ai.openai.model': 'gpt-4o-mini',
    'ai.timeoutMs': 5000,
    'ai.maxRetries': 2,
    'ai.monthlyBudgetTokens': 1_000_000,
    'ai.feature.reviewSummaryEnabled': false,
    'ai.feature.faqAutoAnswerEnabled': false,
    'ai.feature.recommendationsEnabled': false,
    'ai.feature.fraudToxicityEnabled': false,
    ...overrides,
  };
}

/** A fake SettingsService — `.get(key)` returns the configured value. */
function makeFakeSettings(map: SettingsMap) {
  return {
    get<T>(key: string): Promise<T> {
      return Promise.resolve(map[key as keyof SettingsMap] as unknown as T);
    },
    // Not used by AiService but kept for type-compatibility.
    set: () => Promise.resolve(),
    getPublic: () => Promise.resolve({}),
  } as unknown as SettingsService;
}

/** A fake CacheService — in-memory Map. */
function makeFakeCache() {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): Promise<T | null> {
      return Promise.resolve((store.get(key) as T) ?? null);
    },
    set(key: string, value: unknown, _ttlSec: number): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    del(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    _store: store,
  } as unknown as CacheService;
}

/** A fake AiCallsRepository — in-memory array. */
function makeFakeCallsRepo(initialSpend = 0) {
  const rows: AiCallDbRow[] = [];
  let spend = initialSpend;
  const repo: AiCallsRepositoryLike & {
    _rows: AiCallDbRow[];
    _inserted: NewAiCallDbRow[];
    _spendOverride: number | null;
  } = {
    _rows: rows,
    _inserted: [],
    _spendOverride: null,
    async insert(row: NewAiCallDbRow) {
      const inserted: AiCallDbRow = {
        id: crypto.randomUUID(),
        feature: row.feature,
        driver: row.driver,
        model: row.model ?? null,
        ok: row.ok,
        promptTokens: row.promptTokens ?? 0,
        completionTokens: row.completionTokens ?? 0,
        latencyMs: row.latencyMs ?? 0,
        errorCode: (row.errorCode ?? null) as AiErrorCode | null,
        errorMessage: row.errorMessage ?? null,
        promptExcerpt: row.promptExcerpt,
        completionExcerpt: row.completionExcerpt,
        createdAt: new Date(),
      };
      rows.push(inserted);
      (this as { _inserted: NewAiCallDbRow[] })._inserted.push(row);
      // Update the spend so subsequent calls see the debited amount.
      if (inserted.ok) spend += inserted.promptTokens + inserted.completionTokens;
      return inserted;
    },
    async list(filters, limit, offset) {
      let filtered = rows.slice().reverse(); // newest first
      if (filters.feature) filtered = filtered.filter((r) => r.feature === filters.feature);
      if (filters.driver) filtered = filtered.filter((r) => r.driver === filters.driver);
      if (typeof filters.ok === 'boolean') filtered = filtered.filter((r) => r.ok === filters.ok);
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return { rows: page, total };
    },
    async monthlySpend() {
      return (this as { _spendOverride: number | null })._spendOverride ?? spend;
    },
  };
  return repo;
}

function makeService(overrides: Partial<SettingsMap> = {}, initialSpend = 0) {
  const settings = makeFakeSettings(makeSettings(overrides));
  const cache = makeFakeCache();
  const callsRepo = makeFakeCallsRepo(initialSpend);
  const fakeDriver = new FakeAiDriver();
  const openaiDriver = new OpenAiDriver();
  const ruleDriver = new RuleAiDriver();
  const service = new AiService(
    settings,
    cache,
    callsRepo,
    fakeDriver, // AI_DRIVER binding — service re-reads ai.driver at call time.
    fakeDriver,
    openaiDriver,
    ruleDriver,
  );
  return { service, settings, cache, callsRepo, fakeDriver, openaiDriver, ruleDriver };
}

function makeReq(overrides: Partial<AiCompletionRequest> = {}): AiCompletionRequest {
  return {
    feature: 'review_summary',
    messages: [{ role: 'user', content: '5|خوب بود' }],
    maxTokens: 64,
    temperature: 0.2,
    ...overrides,
  };
}

describe('AiService — feature gating (A9.1)', () => {
  it('returns AI_DISABLED (with rule fallback) when ai.enabled is false', async () => {
    const { service, callsRepo } = makeService({ 'ai.enabled': false });
    const r = await service.complete(makeReq());
    // review_summary chains to rule driver even when disabled.
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('rule');
    // A log row is still inserted (records the fallback path).
    expect(callsRepo._rows).toHaveLength(1);
    expect(callsRepo._rows[0]!.driver).toBe('rule');
  });

  it('returns AI_DISABLED for a non-summary feature with its flag off', async () => {
    const { service, callsRepo } = makeService({
      'ai.feature.faqAutoAnswerEnabled': false,
      'ai.driver': 'fake',
    });
    const r = await service.complete(makeReq({ feature: 'faq_auto_answer' }));
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('AI_DISABLED');
    expect(r.driver).toBe('fake');
    expect(callsRepo._rows).toHaveLength(1);
    expect(callsRepo._rows[0]!.ok).toBe(false);
    expect(callsRepo._rows[0]!.errorCode).toBe('AI_DISABLED');
  });

  it('admin_test bypasses the per-feature flag (but respects ai.enabled)', async () => {
    const { service } = makeService({
      'ai.driver': 'fake',
      'ai.feature.reviewSummaryEnabled': false,
    });
    const r = await service.complete(makeReq({ feature: 'admin_test' }));
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
  });

  it('admin_test respects ai.enabled=false', async () => {
    const { service } = makeService({ 'ai.enabled': false });
    const r = await service.complete(makeReq({ feature: 'admin_test' }));
    // admin_test has no rule fallback → returns AI_DISABLED.
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('AI_DISABLED');
  });
});

describe('AiService — budget gate (A9.1)', () => {
  it('returns AI_BUDGET_EXHAUSTED when spend >= budget', async () => {
    const { service, callsRepo } = makeService(
      {
        'ai.monthlyBudgetTokens': 100,
        'ai.feature.reviewSummaryEnabled': true,
      },
      200,
    ); // already spent 200 ≥ 100 budget
    const r = await service.complete(makeReq());
    // review_summary chains to rule driver on budget exhaustion.
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('rule');
    expect(callsRepo._rows[0]!.driver).toBe('rule');
  });

  it('non-summary feature returns AI_BUDGET_EXHAUSTED with no fallback', async () => {
    const { service } = makeService(
      {
        'ai.monthlyBudgetTokens': 100,
        'ai.feature.faqAutoAnswerEnabled': true,
      },
      200,
    );
    const r = await service.complete(makeReq({ feature: 'faq_auto_answer' }));
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('AI_BUDGET_EXHAUSTED');
  });

  it('monthlyBudgetTokens=0 disables the cap (unlimited)', async () => {
    const { service } = makeService(
      {
        'ai.monthlyBudgetTokens': 0,
        'ai.feature.reviewSummaryEnabled': true,
        'ai.driver': 'fake',
      },
      999_999,
    );
    const r = await service.complete(makeReq());
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
  });
});

describe('AiService — fake driver path (A9.1)', () => {
  it('calls the fake driver and logs the row', async () => {
    const { service, callsRepo } = makeService({
      'ai.driver': 'fake',
      'ai.feature.reviewSummaryEnabled': true,
    });
    const r = await service.complete(makeReq());
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
    expect(callsRepo._rows).toHaveLength(1);
    expect(callsRepo._rows[0]!.driver).toBe('fake');
    expect(callsRepo._rows[0]!.promptTokens).toBeGreaterThan(0);
    // Prompt excerpt was truncated to 200 chars and stored.
    expect(callsRepo._rows[0]!.promptExcerpt.length).toBeLessThanOrEqual(200);
  });
});

describe('AiService — rule driver path (A9.1)', () => {
  it('calls the rule driver directly when driver=rule', async () => {
    const { service, callsRepo } = makeService({
      'ai.driver': 'rule',
      'ai.feature.reviewSummaryEnabled': true,
    });
    const r = await service.complete(makeReq());
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('rule');
    expect(r.model).toBe('rule-fa-v1');
    expect(r.text).toMatch(/1 نظر/);
    expect(callsRepo._rows[0]!.driver).toBe('rule');
  });
});

describe('AiService — openai retry + fallback (A9.1)', () => {
  it('retries transient 5xx failures up to maxRetries, then falls back to rule', async () => {
    const fetchMock = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/plain' },
      });
    }) as typeof fetch;
    try {
      const { service, callsRepo } = makeService({
        'ai.driver': 'openai',
        'ai.maxRetries': 2,
        'ai.feature.reviewSummaryEnabled': true,
      });
      const r = await service.complete(makeReq());
      // All 3 attempts (initial + 2 retries) failed; rule fallback ran.
      expect(calls).toBe(3);
      expect(r.ok).toBe(true);
      expect(r.driver).toBe('rule');
      // The logged row records the fallback driver (rule), not the failed one.
      expect(callsRepo._rows[0]!.driver).toBe('rule');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('does NOT retry 4xx — falls back to rule immediately', async () => {
    const fetchMock = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'bad model' } }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const { service } = makeService({
        'ai.driver': 'openai',
        'ai.maxRetries': 3,
        'ai.feature.reviewSummaryEnabled': true,
      });
      const r = await service.complete(makeReq());
      // Only ONE attempt was made (4xx is not retried).
      expect(calls).toBe(1);
      expect(r.ok).toBe(true);
      expect(r.driver).toBe('rule');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('succeeds on retry after a transient 5xx', async () => {
    const fetchMock = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response('Bad Gateway', {
          status: 502,
          statusText: 'Bad Gateway',
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'خلاصه موفق' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const { service, callsRepo } = makeService({
        'ai.driver': 'openai',
        'ai.maxRetries': 2,
        'ai.feature.reviewSummaryEnabled': true,
      });
      const r = await service.complete(makeReq());
      // Two attempts: first 502, second 200.
      expect(calls).toBe(2);
      expect(r.ok).toBe(true);
      expect(r.driver).toBe('openai');
      expect(r.text).toBe('خلاصه موفق');
      expect(r.promptTokens).toBe(50);
      expect(r.completionTokens).toBe(10);
      expect(callsRepo._rows[0]!.driver).toBe('openai');
      expect(callsRepo._rows[0]!.ok).toBe(true);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('non-summary feature ALSO falls back to rule on driver failure', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as typeof fetch;
    try {
      const { service } = makeService({
        'ai.driver': 'openai',
        'ai.maxRetries': 0,
        'ai.feature.faqAutoAnswerEnabled': true,
      });
      const r = await service.complete(makeReq({ feature: 'faq_auto_answer' }));
      // Non-summary features still get a rule-driver fallback (canned reply).
      expect(r.ok).toBe(true);
      expect(r.driver).toBe('rule');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});

describe('AiService — admin endpoints (A9.1)', () => {
  it('test() sends a canned prompt through the configured driver', async () => {
    const { service } = makeService({ 'ai.driver': 'fake' });
    const r = await service.test({ prompt: 'hello' });
    expect(r.prompt).toBe('hello');
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
  });

  it('test() defaults the prompt when none provided', async () => {
    const { service } = makeService({ 'ai.driver': 'fake' });
    const r = await service.test({});
    expect(r.prompt).toBe('در یک کلمه بگو سلام');
  });

  it('getConfig() returns the resolved config with hasApiKey=true', async () => {
    const { service } = makeService({ 'ai.driver': 'openai', 'ai.openai.apiKey': 'sk-xyz' });
    const cfg = await service.getConfig();
    expect(cfg.driver).toBe('openai');
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
    expect(cfg.hasApiKey).toBe(true);
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.monthlyBudgetTokens).toBe(1_000_000);
    expect(cfg.features.review_summary).toBe(false);
    expect(cfg.features.admin_test).toBe(true);
  });

  it('getConfig() returns hasApiKey=false when apiKey is empty', async () => {
    const { service } = makeService({ 'ai.driver': 'openai', 'ai.openai.apiKey': '' });
    const cfg = await service.getConfig();
    expect(cfg.hasApiKey).toBe(false);
  });

  it('listCalls() paginates the log', async () => {
    const { service } = makeService({
      'ai.driver': 'fake',
      'ai.feature.reviewSummaryEnabled': true,
    });
    // Make 5 calls.
    for (let i = 0; i < 5; i++) {
      await service.complete(makeReq());
    }
    const page1 = await service.listCalls({ page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    const page3 = await service.listCalls({ page: 3, pageSize: 2 });
    expect(page3.items).toHaveLength(1);
  });

  it('listCalls() filters by feature', async () => {
    const { service } = makeService({
      'ai.driver': 'fake',
      'ai.feature.reviewSummaryEnabled': true,
      'ai.feature.faqAutoAnswerEnabled': true,
    });
    await service.complete(makeReq({ feature: 'review_summary' }));
    await service.complete(makeReq({ feature: 'faq_auto_answer' }));
    const onlyFaq = await service.listCalls({ feature: 'faq_auto_answer' });
    expect(onlyFaq.total).toBe(1);
    expect(onlyFaq.items[0]!.feature).toBe('faq_auto_answer');
  });
});

describe('AiService — fail-soft (A9.1)', () => {
  it('a repo insert failure does NOT break the call', async () => {
    const settings = makeFakeSettings(
      makeSettings({
        'ai.driver': 'fake',
        'ai.feature.reviewSummaryEnabled': true,
      }),
    );
    const cache = makeFakeCache();
    const failingRepo: AiCallsRepositoryLike = {
      async insert() {
        throw new Error('DB down');
      },
      async list() {
        return { rows: [], total: 0 };
      },
      async monthlySpend() {
        return 0;
      },
    };
    const service = new AiService(
      settings,
      cache,
      failingRepo,
      new FakeAiDriver(),
      new FakeAiDriver(),
      new OpenAiDriver(),
      new RuleAiDriver(),
    );
    const r = await service.complete(makeReq());
    // The call still succeeded despite the log failure.
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
  });
});

describe('AiService — caching the monthly spend (A9.1)', () => {
  beforeEach(() => {
    // Reset the cache between tests.
  });

  it('caches the monthly spend so the second call does not hit the repo', async () => {
    const settings = makeFakeSettings(
      makeSettings({
        'ai.driver': 'fake',
        'ai.feature.reviewSummaryEnabled': true,
      }),
    );
    const cache = makeFakeCache();
    let spendCalls = 0;
    const callsRepo: AiCallsRepositoryLike = {
      async insert(): Promise<AiCallDbRow> {
        return {
          id: '00000000-0000-4000-8000-0000000000a1',
          feature: 'review_summary',
          driver: 'fake',
          model: null,
          ok: true,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          errorCode: null,
          errorMessage: null,
          promptExcerpt: '',
          completionExcerpt: '',
          createdAt: new Date(),
        };
      },
      async list() {
        return { rows: [], total: 0 };
      },
      async monthlySpend() {
        spendCalls++;
        return 0;
      },
    };
    const service = new AiService(
      settings,
      cache,
      callsRepo,
      new FakeAiDriver(),
      new FakeAiDriver(),
      new OpenAiDriver(),
      new RuleAiDriver(),
    );
    await service.complete(makeReq());
    await service.complete(makeReq());
    // monthlySpend was called once and the result was cached for the second.
    expect(spendCalls).toBe(1);
  });
});
