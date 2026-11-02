// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initialsFromName } from '../../src/components/ui/avatar';

describe('initialsFromName (F1.3, ZWNJ-aware)', () => {
  it('takes the first letter of the first two Latin words', () => {
    expect(initialsFromName('Jane Doe')).toBe('JD');
    expect(initialsFromName('Alice Bob Carol')).toBe('AB');
  });

  it('returns two letters of a single Latin word', () => {
    expect(initialsFromName('Madonna')).toBe('Ma');
  });

  it('splits a Persian name on a regular space', () => {
    // «علی رضایی» → «عر»
    expect(initialsFromName('علی رضایی')).toBe('عر');
  });

  it('treats a ZWNJ (U+200C) the same as a space so compound names split', () => {
    // «علی‌رضا احمدی» (ZWNJ inside the first word) → after ZWNJ→space becomes
    // «علی رضا احمدی» → first letters of first two words = «ع» + «ر» = «عر»
    expect(initialsFromName('علی‌رضا احمدی')).toBe('عر');
  });

  it('returns two letters when the whole name is one ZWNJ-compound word', () => {
    expect(initialsFromName('علی‌رضایی')).toBe('عر');
  });

  it('returns the empty string for blank input', () => {
    expect(initialsFromName('')).toBe('');
    expect(initialsFromName('   ')).toBe('');
    expect(initialsFromName('\u200c\u200c')).toBe('');
  });

  it('ignores leading/trailing whitespace and collapses runs', () => {
    expect(initialsFromName('  علی   رضایی  ')).toBe('عر');
  });
});
