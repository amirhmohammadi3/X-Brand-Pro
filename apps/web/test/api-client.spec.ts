import { z } from 'zod';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, isApiRequestError } from '../src/lib/api/errors';
import { apiFetch, buildQuery } from '../src/lib/api/client';

const dataSchema = z.object({ id: z.string(), score: z.number() });

const OK_ENVELOPE = { ok: true, data: { id: 'abc', score: 4.5 } };
const FAIL_ENVELOPE = {
  ok: false,
  error: {
    code: 'RATE_LIMITED',
    messageKey: 'errors.rate_limited',
    message: 'Too many requests',
    requestId: 'req-123',
  },
};

function mockFetchOnce(payload: unknown, init: ResponseInit = {}) {
  const fn = vi.fn(
    async () =>
      new Response(payload === null ? null : JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-123' },
        ...init,
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('buildQuery (F0.2)', () => {
  it('skips null/undefined/empty values and encodes the rest', () => {
    expect(buildQuery({ a: 'x y', b: 2, c: undefined, d: null, e: '' })).toBe('?a=x+y&b=2');
  });

  it('repeats keys for arrays', () => {
    expect(buildQuery({ tag: ['food', 'cafe'] })).toBe('?tag=food&tag=cafe');
  });

  it('returns an empty string for an empty record', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery()).toBe('');
  });
});

describe('apiFetch (F0.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed data (and meta when present) on a success envelope', async () => {
    mockFetchOnce({ ...OK_ENVELOPE, meta: { total: 3 } });
    const result = await apiFetch('/things', dataSchema);
    expect(result.data).toEqual({ id: 'abc', score: 4.5 });
    expect(result.meta).toEqual({ total: 3 });
  });

  it('rejects data that does not match the contract schema with INVALID_ENVELOPE', async () => {
    mockFetchOnce({ ok: true, data: { id: 'abc', score: 'not-a-number' } });
    const err = await apiFetch('/things', dataSchema).catch((e: unknown) => e);
    expect(isApiRequestError(err)).toBe(true);
    expect((err as ApiRequestError).code).toBe('INVALID_ENVELOPE');
    expect(Array.isArray((err as ApiRequestError).details)).toBe(true);
  });

  it('maps a failure envelope to ApiRequestError with the envelope fields', async () => {
    mockFetchOnce(FAIL_ENVELOPE, { status: 429 });
    const err = await apiFetch('/things', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    const apiError = err as ApiRequestError;
    expect(apiError.status).toBe(429);
    expect(apiError.code).toBe('RATE_LIMITED');
    expect(apiError.messageKey).toBe('errors.rate_limited');
    expect(apiError.requestId).toBe('req-123');
    expect(apiError.isRateLimited).toBe(true);
  });

  it('reports INVALID_ENVELOPE for a non-JSON error response', async () => {
    const fn = vi.fn(async () => new Response('<html>oops</html>', { status: 502 }));
    vi.stubGlobal('fetch', fn);
    const err = await apiFetch('/things', dataSchema).catch((e: unknown) => e);
    expect((err as ApiRequestError).code).toBe('INVALID_ENVELOPE');
    expect((err as ApiRequestError).status).toBe(502);
  });

  it('wraps network failures in NETWORK_ERROR with status 0 (aborts stay untouched)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    const err = await apiFetch('/things', dataSchema).catch((e: unknown) => e);
    expect((err as ApiRequestError).code).toBe('NETWORK_ERROR');
    expect((err as ApiRequestError).status).toBe(0);

    const controller = new AbortController();
    controller.abort();
    const abortErr = await apiFetch('/things', dataSchema, { signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(isApiRequestError(abortErr)).toBe(false); // abort is not an API error
  });

  it('sends JSON content type and the Idempotency-Key header when provided', async () => {
    const fn = mockFetchOnce(OK_ENVELOPE);
    await apiFetch('/things', dataSchema, {
      method: 'POST',
      body: { x: 1 },
      idempotencyKey: 'key-1',
    });
    const [, init] = (fn.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('key-1');
    expect(init.method).toBe('POST');
  });

  it('treats HTTP 204 as an empty success', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fn);
    const result = await apiFetch('/things', dataSchema);
    expect(result.data).toBeUndefined();
  });

  it('prefixes the base API URL and appends the built query', async () => {
    const fn = mockFetchOnce(OK_ENVELOPE);
    await apiFetch('/things', dataSchema, { query: { page: 2 } });
    const [url] = (fn.mock.calls[0] ?? []) as unknown as [string];
    expect(url).toMatch(/\/api\/v1\/things\?page=2$/);
  });
});
