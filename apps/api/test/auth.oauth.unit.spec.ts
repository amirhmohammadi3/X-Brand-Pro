import { describe, expect, it } from 'vitest';
import { deriveUsernameFromEmail, safeOauthNext } from '../src/modules/auth/auth-oauth.service.js';

describe('safeOauthNext (B1.8)', () => {
  it('accepts relative paths and keeps them intact', () => {
    expect(safeOauthNext('/dashboard')).toBe('/dashboard');
    expect(safeOauthNext('/business/42?tab=photos')).toBe('/business/42?tab=photos');
    expect(safeOauthNext(undefined)).toBe('/');
    expect(safeOauthNext('')).toBe('/');
  });

  it('neutralizes open-redirect and exotic targets', () => {
    expect(safeOauthNext('//evil.example.com')).toBe('/');
    expect(safeOauthNext('https://evil.example.com')).toBe('/');
    expect(safeOauthNext('http://evil.example.com/x')).toBe('/');
    expect(safeOauthNext('/\\evil')).toBe('/');
    expect(safeOauthNext('/ok\nSet-Cookie: x')).toBe('/');
    expect(safeOauthNext('dashboard')).toBe('/');
  });
});

describe('deriveUsernameFromEmail (B1.8)', () => {
  it('derives a clean username from the local part', () => {
    expect(deriveUsernameFromEmail('Amir.HM@googlemail.ir')).toBe('amir.hm');
    expect(deriveUsernameFromEmail('user+tag@sub.example.com')).toBe('usertag');
  });

  it('truncates to 20 chars and falls back when nothing usable remains', () => {
    expect(deriveUsernameFromEmail('aaaaaaaaaaaaaaaaaaaaaaaaaa@x.com')).toBe('a'.repeat(20));
    const unicode = deriveUsernameFromEmail('سلام@x.com');
    expect(unicode).toMatch(/^user\d{5}$/);
  });
});
