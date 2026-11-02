import { describe, expect, it } from 'vitest';
import { normalizeIranianPhone, toIranianNationalDisplay } from '../../src/lib/forms/phone';

describe('phone normalization (F1.4)', () => {
  describe('normalizeIranianPhone -> E.164', () => {
    // The exact table the F1.4 prompt requires.
    it.each([
      ['0912 345 6789', '+989123456789'],
      ['۰۹۱۲۳۴۵۶۷۸۹', '+989123456789'], // Persian digits
      ['+98 912 345 6789', '+989123456789'],
      ['0098 912 345 6789', '+989123456789'],
      ['9123456789', '+989123456789'], // missing leading 0
      ['0912-345-6789', '+989123456789'], // dashes stripped
      ['(0912) 345 6789', '+989123456789'], // parens stripped
      ['', ''],
    ])('%p -> %p', (input, expected) => {
      expect(normalizeIranianPhone(input)).toBe(expected);
    });

    it('preserves an obviously non-Iranian international number', () => {
      // A US number: not 98, not 0 — should stay as +1...
      expect(normalizeIranianPhone('+1 415 555 2671')).toBe('+14155552671');
    });
  });

  describe('toIranianNationalDisplay', () => {
    it.each([
      ['+989123456789', '0912 345 6789'],
      ['09123456789', '0912 345 6789'],
      ['9123456789', '0912 345 6789'],
    ])('%p -> %p', (input, expected) => {
      expect(toIranianNationalDisplay(input)).toBe(expected);
    });
  });
});
