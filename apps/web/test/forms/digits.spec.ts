import { describe, expect, it } from 'vitest';
import { toAsciiDigits, toPersianDigits, toDisplayDigits } from '../../src/lib/forms/digits';

describe('digits helpers (F1.4)', () => {
  describe('toAsciiDigits', () => {
    it.each([
      ['۰۱۲۳۴۵۶۷۸۹', '0123456789', 'Persian digits'],
      ['٠١٢٣٤٥٦٧٨٩', '0123456789', 'Arabic-Indic digits'],
      ['۰۹۱۲۳۴۵۶۷۸۹', '09123456789', 'Persian phone'],
      ['+98 912 345 6789', '+98 912 345 6789', 'ASCII passthrough'],
      ['abc', 'abc', 'non-digit passthrough'],
      ['', '', 'empty'],
    ])('%s -> %s (%s)', (input, expected) => {
      expect(toAsciiDigits(input)).toBe(expected);
    });
  });

  describe('toPersianDigits', () => {
    it('converts ASCII digits to Persian', () => {
      expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    });
    it('leaves non-digits untouched', () => {
      expect(toPersianDigits('abc123')).toBe('abc۱۲۳');
    });
  });

  describe('toDisplayDigits', () => {
    it('returns Persian digits in fa locale', () => {
      expect(toDisplayDigits('123456', 'fa')).toBe('۱۲۳۴۵۶');
    });
    it('returns ASCII digits in en locale', () => {
      expect(toDisplayDigits('123456', 'en')).toBe('123456');
    });
  });
});
