import { describe, expect, it, vi } from 'vitest';
import { scorePassword } from '../../src/components/ui/form/password-input';

describe('PasswordInput strength (F1.4)', () => {
  it('scores empty as 0', () => {
    expect(scorePassword('')).toBe(0);
  });

  it('scores a short single-class password as 0', () => {
    expect(scorePassword('abc')).toBe(0);
  });

  it('scores a long-enough single-class password as 1', () => {
    // 8 lowercase letters: 1 variety + 1 length bonus = 2 -> score 1
    expect(scorePassword('abcdefgh')).toBe(1);
  });

  it('scores letters+digits as at least 2', () => {
    // 2 varieties + 1 length bonus = 3 -> score 2
    expect(scorePassword('abcd1234')).toBe(2);
  });

  it('scores letters+mixed case+digits as 3 or 4', () => {
    // 3 varieties + 1 length bonus = 4 -> score 3
    expect(scorePassword('Abcd1234')).toBeGreaterThanOrEqual(3);
  });

  it('scores a strong mix as 4', () => {
    // 4 varieties + 2 length bonus = 6 -> score 4
    expect(scorePassword('Abcd1234!@#$efgh')).toBe(4);
  });
});

// Silence the unused-import lint for the mock helper below.
void vi;
