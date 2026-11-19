import { describe, expect, it } from 'vitest';
import { FakeAiDriver } from '../src/modules/ai/fake-ai.driver.js';
import { OpenAiDriver } from '../src/modules/ai/openai-ai.driver.js';
import { RuleAiDriver, synthesize } from '../src/modules/ai/rule-ai.driver.js';
import type { AiCompletionRequest } from '@app/contracts';

/**
 * A9.1 / A9.2 — AI drivers. The fake driver (no network, canned response),
 * the openai driver (timeout / 4xx / 5xx / invalid-response / no-credentials
 * paths), and the rule driver (statistical Persian summary). All three are
 * pure (no DI), so they can be tested in isolation.
 */

function makeReq(overrides: Partial<AiCompletionRequest> = {}): AiCompletionRequest {
  return {
    feature: 'review_summary',
    messages: [{ role: 'user', content: 'در یک کلمه بگو سلام' }],
    maxTokens: 64,
    temperature: 0.2,
    ...overrides,
  };
}

describe('FakeAiDriver (A9.1)', () => {
  const driver = new FakeAiDriver();

  it('returns a deterministic canned response with non-zero token estimate', async () => {
    const r = await driver.complete(makeReq());
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('fake');
    expect(r.model).toBeNull();
    expect(r.text).toContain('سلام');
    expect(r.text).toContain('prompt length:');
    expect(r.promptTokens).toBeGreaterThan(0);
    expect(r.completionTokens).toBeGreaterThan(0);
    expect(r.errorCode).toBeNull();
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reflects the prompt length in the canned text', async () => {
    const long = 'x'.repeat(200);
    const r = await driver.complete(makeReq({ messages: [{ role: 'user', content: long }] }));
    expect(r.text).toContain('200');
    // Token estimate = ceil(200/4) = 50
    expect(r.promptTokens).toBe(50);
  });

  it('never fails — even on an empty prompt', async () => {
    const r = await driver.complete(makeReq({ messages: [{ role: 'user', content: 'x' }] }));
    expect(r.ok).toBe(true);
  });
});

describe('OpenAiDriver (A9.1)', () => {
  const driver = new OpenAiDriver();
  const cfg = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    timeoutMs: 5000,
  };

  it('returns AI_NO_CREDENTIALS when cfg is null', async () => {
    driver.cfg = null;
    const r = await driver.complete(makeReq());
    expect(r.ok).toBe(false);
    expect(r.driver).toBe('openai');
    expect(r.errorCode).toBe('AI_NO_CREDENTIALS');
    expect(r.errorMessage).toMatch(/cfg was not set/);
  });

  it('returns AI_NO_CREDENTIALS when apiKey is empty', async () => {
    driver.cfg = { ...cfg, apiKey: '' };
    const r = await driver.complete(makeReq());
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('AI_NO_CREDENTIALS');
    expect(r.errorMessage).toMatch(/No API key/);
    // No network call should have been made (we did not stub fetch).
  });

  it('parses a successful chat/completions response', async () => {
    const fetchMock = globalThis.fetch;
    let calledUrl = '';
    let calledAuth = '';
    let calledBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calledUrl = String(url);
      const headers = init.headers as Record<string, string>;
      calledAuth = headers.authorization ?? '';
      calledBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'سلام!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(true);
      expect(r.text).toBe('سلام!');
      expect(r.promptTokens).toBe(10);
      expect(r.completionTokens).toBe(5);
      expect(r.model).toBe('gpt-4o-mini');
      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
      expect(calledAuth).toBe('Bearer sk-test');
      expect(calledBody.model).toBe('gpt-4o-mini');
      expect(calledBody.stream).toBe(false);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('strips trailing slashes from baseUrl', async () => {
    const fetchMock = globalThis.fetch;
    let calledUrl = '';
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      driver.cfg = { ...cfg, baseUrl: 'https://api.openai.com/v1/' };
      await driver.complete(makeReq());
      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
      driver.cfg = { ...cfg, baseUrl: 'https://api.openai.com/v1//' };
      await driver.complete(makeReq());
      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_INVALID_RESPONSE when body is not JSON', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_INVALID_RESPONSE');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_INVALID_RESPONSE when choices[0].message.content is missing', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: {} }], usage: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_INVALID_RESPONSE');
      expect(r.errorMessage).toMatch(/choices\[0\]/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_INVALID_RESPONSE on 4xx (not retriable)', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid model' } }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_INVALID_RESPONSE');
      expect(r.errorMessage).toMatch(/HTTP 404/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_NO_CREDENTIALS on 401 Unauthorized', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_NO_CREDENTIALS');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_DRIVER_FAILED on 5xx (retriable)', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_DRIVER_FAILED');
      expect(r.errorMessage).toMatch(/HTTP 502/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_DRIVER_FAILED on a soft error in the body (status 200)', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_DRIVER_FAILED');
      expect(r.errorMessage).toMatch(/rate limited/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_DRIVER_FAILED on a fetch network error', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_DRIVER_FAILED');
      expect(r.errorMessage).toMatch(/ECONNREFUSED/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('returns AI_DRIVER_FAILED on an AbortError (timeout)', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (_url: string, _init: RequestInit) => {
      // Simulate the AbortController firing immediately.
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof fetch;
    try {
      driver.cfg = { ...cfg, timeoutMs: 1 };
      const r = await driver.complete(makeReq());
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('AI_DRIVER_FAILED');
      expect(r.errorMessage).toMatch(/timed out/);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('estimates tokens from char/4 when usage is missing', async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'سلام!' } }] /* no usage */ }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    try {
      driver.cfg = cfg;
      const r = await driver.complete(
        makeReq({ messages: [{ role: 'user', content: 'x'.repeat(40) }] }),
      );
      expect(r.ok).toBe(true);
      // Prompt = ceil(40/4) = 10; completion = ceil(5/4) = 2.
      expect(r.promptTokens).toBe(10);
      expect(r.completionTokens).toBe(2);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});

describe('RuleAiDriver (A9.2)', () => {
  const driver = new RuleAiDriver();

  it('never fails — even on an empty prompt', async () => {
    const r = await driver.complete(makeReq({ messages: [{ role: 'user', content: '' }] }));
    expect(r.ok).toBe(true);
    expect(r.driver).toBe('rule');
    expect(r.model).toBe('rule-fa-v1');
  });

  it('synthesizes a review summary from `<rating>|<body>` lines', async () => {
    const prompt = `5|خدمت عالی بود
4|خوب بود
2|کمی کند بود`;
    const text = synthesize('review_summary', prompt);
    expect(text).toMatch(/3 نظر/);
    expect(text).toMatch(/میانگین امتیاز/);
    // 5+4=9 positive, 2 negative → majority positive
    expect(text).toMatch(/راضی/);
  });

  it('returns a neutral summary when no reviews parse', async () => {
    const text = synthesize('review_summary', 'garbage\nmore garbage');
    expect(text).toMatch(/هنوز نظری/);
  });

  it('flags a mostly-negative review set', async () => {
    const prompt = `1|خیلی بد بود
1|افتضاح
2|بد بود`;
    const text = synthesize('review_summary', prompt);
    expect(text).toMatch(/ناراضی/);
  });

  it('emits a JSON fraud score for the fraud_toxicity feature', async () => {
    const text = synthesize('fraud_toxicity', 'این یک کلاهبرداری است!!!');
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('score');
    expect(parsed.score).toBeGreaterThan(0);
    expect(parsed.score).toBeLessThanOrEqual(1);
    expect(parsed.signals).toContain('rule-based');
  });

  it('returns a canned reply for non-summary features', async () => {
    const text = synthesize('faq_auto_answer', 'anything');
    expect(text).toMatch(/آزمایشی مبتنی بر قاعده/);
  });

  it('driver.complete for review_summary returns the synthesized text', async () => {
    const r = await driver.complete(
      makeReq({
        feature: 'review_summary',
        messages: [{ role: 'user', content: '5|خوب بود\n4|عالی بود' }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/2 نظر/);
    expect(r.text).toMatch(/راضی/);
  });
});
