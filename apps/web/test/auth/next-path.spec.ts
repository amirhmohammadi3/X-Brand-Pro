import { describe, expect, it } from 'vitest';
import { safeNextPath } from '../../src/lib/auth/next-path';

/**
 * The `?next=` open-redirect guard table required by the F1.8 prompt:
 * only site-relative paths survive; protocol-relative, scheme and backslash
 * smugglings fall back to `/`.
 */
describe('safeNextPath (F1.8 open-redirect guard)', () => {
  it.each([
    ['/account', '/account'],
    ['/account/profile?tab=sessions', '/account/profile?tab=sessions'],
    ['/', '/'],
    ['/account#reviews', '/account#reviews'],
    ['', '/'],
    [undefined, '/'],
    [null, '/'],
    ['   ', '/'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['http://evil.com/path', '/'],
    ['javascript:alert(1)', '/'],
    ['JAVASCRIPT:alert(1)', '/'],
    ['data:text/html,<script>alert(1)</script>', '/'],
    ['\\evil', '/'],
    ['/\\evil', '/'],
    ['/ /x', '/'],
    ['/line\nbreak', '/'],
    ['/tab\there', '/'],
    ['account', '/'],
  ])('safeNextPath(%j) → %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it('honors a custom fallback for rejected values', () => {
    expect(safeNextPath('javascript:alert(1)', '/login')).toBe('/login');
    expect(safeNextPath(null, '/login')).toBe('/login');
  });

  it('caps absurd lengths', () => {
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe('/');
    // The guard measures the WHOLE string, so '/'+511 = 512 chars is the last
    // accepted length.
    expect(safeNextPath(`/${'a'.repeat(511)}`)).toBe(`/${'a'.repeat(511)}`);
  });
});
