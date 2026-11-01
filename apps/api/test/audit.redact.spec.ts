import { describe, expect, it } from 'vitest';
import { redact } from '../src/modules/audit/audit.service.js';

/**
 * Unit tests for the audit redaction function (B1.11): nested objects,
 * arrays, case-insensitive key matching, depth cap and string truncation.
 */
describe('audit redact (B1.11)', () => {
  it('redacts sensitive keys case-insensitively at any casing', () => {
    expect(redact({ Password: 'x', Api_Key: 'y', AUTHORIZATION: 'z' })).toEqual({
      Password: '[redacted]',
      Api_Key: '[redacted]',
      AUTHORIZATION: '[redacted]',
    });
  });

  it('redacts nested objects and walks arrays', () => {
    const input = {
      user: { name: 'amir', password: 'plain', tokens: ['a', 'b'] },
      meta: { headers: { authorization: 'Bearer x', cookie: 'at=1' } },
      list: [{ otp: '12345', keep: 1 }, null, 'text'],
    };
    expect(redact(input)).toEqual({
      user: { name: 'amir', password: '[redacted]', tokens: '[redacted]' },
      meta: { headers: { authorization: '[redacted]', cookie: '[redacted]' } },
      list: [{ otp: '[redacted]', keep: 1 }, null, 'text'],
    });
  });

  it('matches the documented key pattern exactly (incl. code$ suffix)', () => {
    expect(redact({ confirmation_code: 'x', codecov: 'y', resetCode: 'z' })).toEqual({
      confirmation_code: '[redacted]',
      codecov: 'y', // 'codecov' does not END with 'code'
      resetCode: '[redacted]',
    });
  });

  it('truncates strings longer than 2000 chars but keeps shorter ones', () => {
    const long = 'a'.repeat(2500);
    const out = redact({ long, short: 'fine' }) as { long: string; short: string };
    expect(out.long).toHaveLength(2000);
    expect(out.short).toBe('fine');
  });

  it('collapses deeper than 6 levels to [redacted]', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: { secret: 'deep' } } } } } } } };
    const out = redact(deep) as typeof deep;
    // Level 6 is the last one that is walked; level 7 collapses.
    expect((out.l1.l2.l3.l4.l5.l6 as Record<string, unknown>).l7).toBe('[redacted]');
  });

  it('passes scalars and nulls through untouched', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('handles a secret-bearing nested payload end to end', () => {
    // Note: the key-pattern redactor cannot know that a generic `value` field
    // holds a secret — callers mask those BEFORE calling redact (the settings
    // service passes masked before/after). Pattern-matching keys are caught.
    const after = redact({
      key: 'sms.kavenegar.apiKey',
      apiKey: 'SUPER-SECRET-KEY',
      note: { api_key: 'SUPER-SECRET-KEY' },
    });
    expect(JSON.stringify(after)).not.toContain('SUPER-SECRET-KEY');
  });
});
