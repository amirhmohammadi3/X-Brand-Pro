import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiEnvelopeSchema,
  errorEnvelopeSchema,
  failureEnvelope,
  isApiFailure,
  okEnvelope,
  type ApiEnvelope,
  type ApiFailure,
} from '../envelope.js';
import { ERROR_CODES, ERROR_HTTP_STATUS, errorMessageKey, isErrorCode } from '../errors.js';
import {
  cursorMetaSchema,
  cursorQuerySchema,
  pageMetaSchema,
  pageQuerySchema,
} from '../pagination.js';

describe('errors', () => {
  it('has exactly the 16 expected codes', () => {
    expect([...ERROR_CODES]).toEqual([
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      // B1.3 auth codes:
      'INVALID_CREDENTIALS',
      'ACCOUNT_BANNED',
      'TOKEN_REUSED',
      'SESSION_REVOKED',
      'ACCOUNT_LOCKED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'UNPROCESSABLE',
      'SERVICE_UNAVAILABLE',
      'INTERNAL_ERROR',
    ]);
  });

  it('maps each code to a valid HTTP status', () => {
    const expected: Record<string, number> = {
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INVALID_CREDENTIALS: 401,
      ACCOUNT_BANNED: 403,
      TOKEN_REUSED: 401,
      SESSION_REVOKED: 401,
      ACCOUNT_LOCKED: 429,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      UNPROCESSABLE: 422,
      SERVICE_UNAVAILABLE: 503,
      INTERNAL_ERROR: 500,
    };
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBe(expected[code]);
    }
  });

  it('errorMessageKey lowercases the code', () => {
    expect(errorMessageKey('VALIDATION_FAILED')).toBe('errors.validation_failed');
    expect(errorMessageKey('RATE_LIMITED')).toBe('errors.rate_limited');
  });

  it('isErrorCode narrows correctly', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
  });
});

describe('okEnvelope', () => {
  const schema = okEnvelope(z.object({ id: z.number() }));

  it('parses a success payload without meta', () => {
    const parsed = schema.parse({ ok: true, data: { id: 1 } });
    expect(parsed).toEqual({ ok: true, data: { id: 1 } });
  });

  it('accepts a meta schema when provided', () => {
    const withMeta = okEnvelope(z.object({ id: z.number() }), z.object({ total: z.number() }));
    expect(withMeta.parse({ ok: true, data: { id: 1 }, meta: { total: 5 } })).toEqual({
      ok: true,
      data: { id: 1 },
      meta: { total: 5 },
    });
  });

  it('rejects a failure payload', () => {
    expect(() =>
      schema.parse({
        ok: false,
        error: { code: 'NOT_FOUND', messageKey: 'x', message: 'y', requestId: 'r1' },
      }),
    ).toThrow();
  });

  it('rejects when data is invalid', () => {
    expect(() => schema.parse({ ok: true, data: { id: 'nope' } })).toThrow();
  });
});

describe('errorEnvelopeSchema', () => {
  it('parses a full failure payload', () => {
    const v = errorEnvelopeSchema.parse({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        messageKey: 'errors.rate_limited',
        message: 'Too many requests',
        details: { retryAfter: 30 },
        requestId: 'req-1',
      },
    });
    expect(v.error.code).toBe('RATE_LIMITED');
  });

  it('requires code, messageKey, message and requestId', () => {
    expect(() =>
      errorEnvelopeSchema.parse({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } }),
    ).toThrow();
  });

  it('rejects an unknown error code', () => {
    expect(() =>
      errorEnvelopeSchema.parse({
        ok: false,
        error: { code: 'SOMETHING_ELSE', messageKey: 'k', message: 'm', requestId: 'r' },
      }),
    ).toThrow();
  });
});

describe('isApiFailure', () => {
  const success: ApiEnvelope<{ id: number }> = { ok: true, data: { id: 1 } };
  const failure: ApiFailure = failureEnvelope({
    code: 'CONFLICT',
    messageKey: 'errors.conflict',
    message: 'Conflict',
    requestId: 'req-2',
  });

  it('narrows success', () => {
    expect(isApiFailure(success)).toBe(false);
    if (!isApiFailure(success)) {
      expect(success.data.id).toBe(1);
    }
  });

  it('narrows failure and exposes error.code', () => {
    expect(isApiFailure(failure)).toBe(true);
    if (isApiFailure(failure)) {
      expect(failure.error.code).toBe('CONFLICT');
      expect(failure.error.requestId).toBe('req-2');
    }
  });
});

describe('apiEnvelopeSchema', () => {
  it('accepts either shape', () => {
    expect(apiEnvelopeSchema.safeParse({ ok: true, data: null }).success).toBe(true);
    expect(
      apiEnvelopeSchema.safeParse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', messageKey: 'k', message: 'm', requestId: 'r' },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(apiEnvelopeSchema.safeParse({ ok: 'maybe' }).success).toBe(false);
  });
});

describe('pagination', () => {
  it('pageQuerySchema coerces from strings with defaults', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(pageQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('pageQuerySchema enforces bounds', () => {
    expect(() => pageQuerySchema.parse({ page: '0' })).toThrow();
    expect(() => pageQuerySchema.parse({ pageSize: '0' })).toThrow();
    expect(() => pageQuerySchema.parse({ pageSize: '101' })).toThrow();
    expect(() => pageQuerySchema.parse({ page: '1.5' })).toThrow();
  });

  it('cursorQuerySchema defaults limit to 20', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(cursorQuerySchema.parse({ cursor: 'abc', limit: '99' })).toEqual({
      cursor: 'abc',
      limit: 99,
    });
  });

  it('cursorQuerySchema rejects limit over 100', () => {
    expect(() => cursorQuerySchema.parse({ limit: '101' })).toThrow();
  });

  it('pageMetaSchema validates the meta shape', () => {
    expect(pageMetaSchema.parse({ page: 1, pageSize: 20, total: 45, totalPages: 3 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 45,
      totalPages: 3,
    });
    expect(() => pageMetaSchema.parse({ page: 1 })).toThrow();
  });

  it('cursorMetaSchema allows a null nextCursor', () => {
    expect(cursorMetaSchema.parse({ nextCursor: null, hasMore: false })).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(() => cursorMetaSchema.parse({ hasMore: true })).toThrow();
  });
});
