import { describe, expect, it } from 'vitest';
import {
  accessTokenExpiry,
  mergeRequestCookies,
  needsSessionRefresh,
  parseSetCookiePair,
} from '../../src/lib/auth/session-refresh';

function jwtWithExp(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature`;
}

const NOW = 1_800_000_000;

describe('needsSessionRefresh (F1.8 proxy)', () => {
  it('is false without a refresh cookie (nothing to refresh)', () => {
    expect(needsSessionRefresh(undefined, undefined, NOW)).toBe(false);
    expect(needsSessionRefresh(undefined, jwtWithExp(NOW - 100), NOW)).toBe(false);
  });

  it('is true when the access cookie is missing', () => {
    expect(needsSessionRefresh('rt', undefined, NOW)).toBe(true);
  });

  it('is false while the access cookie is fresh', () => {
    expect(needsSessionRefresh('rt', jwtWithExp(NOW + 3_600), NOW)).toBe(false);
  });

  it('is true once the access cookie is expired', () => {
    expect(needsSessionRefresh('rt', jwtWithExp(NOW - 10), NOW)).toBe(true);
  });

  it('treats the leeway window as expired (clock skew)', () => {
    expect(needsSessionRefresh('rt', jwtWithExp(NOW + 10), NOW)).toBe(true);
    expect(needsSessionRefresh('rt', jwtWithExp(NOW + 60), NOW, 30)).toBe(false);
  });

  it('is true for a malformed access cookie (unparseable JWT)', () => {
    expect(needsSessionRefresh('rt', 'garbage', NOW)).toBe(true);
    expect(needsSessionRefresh('rt', 'a.b.c', NOW)).toBe(true);
    expect(needsSessionRefresh('rt', jwtWithExp(NOW).slice(0, -1), NOW)).toBe(true);
  });

  it('is true when the JWT has no numeric exp claim', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(needsSessionRefresh('rt', `header.${payload}.sig`, NOW)).toBe(true);
  });
});

describe('accessTokenExpiry', () => {
  it('returns the exp claim in seconds', () => {
    expect(accessTokenExpiry(jwtWithExp(NOW))).toBe(NOW);
  });

  it('returns null for missing or malformed tokens', () => {
    expect(accessTokenExpiry(undefined)).toBe(null);
    expect(accessTokenExpiry(null)).toBe(null);
    expect(accessTokenExpiry('')).toBe(null);
    expect(accessTokenExpiry('one')).toBe(null);
  });
});

describe('parseSetCookiePair', () => {
  it('extracts name=value and ignores attributes', () => {
    expect(parseSetCookiePair('at=abc.def.ghi; Path=/; HttpOnly; SameSite=Lax')).toEqual({
      name: 'at',
      value: 'abc.def.ghi',
    });
    expect(parseSetCookiePair('rt=xyz; Max-Age=1209600; Path=/')).toEqual({
      name: 'rt',
      value: 'xyz',
    });
  });

  it('keeps values that contain "="', () => {
    expect(parseSetCookiePair('at=aa==; Path=/')).toEqual({ name: 'at', value: 'aa==' });
  });

  it('returns null for garbage lines', () => {
    expect(parseSetCookiePair('nonsense')).toBe(null);
    expect(parseSetCookiePair('=value')).toBe(null);
    expect(parseSetCookiePair('')).toBe(null);
  });
});

describe('mergeRequestCookies', () => {
  it('replaces refreshed cookies and keeps the others in order', () => {
    const merged = mergeRequestCookies('locale=fa; at=old.jwt.token; theme=dark; rt=old-rt', [
      { name: 'at', value: 'new.jwt.token' },
      { name: 'rt', value: 'new-rt' },
    ]);
    expect(merged).toBe('locale=fa; at=new.jwt.token; theme=dark; rt=new-rt');
  });

  it('handles an empty or missing existing header', () => {
    expect(mergeRequestCookies(undefined, [{ name: 'at', value: 'a' }])).toBe('at=a');
    expect(mergeRequestCookies('', [{ name: 'at', value: 'a' }])).toBe('at=a');
  });

  it('keeps the first occurrence of duplicate existing cookies', () => {
    expect(mergeRequestCookies('at=first; at=second', [{ name: 'rt', value: 'r' }])).toBe(
      'at=first; rt=r',
    );
  });
});
