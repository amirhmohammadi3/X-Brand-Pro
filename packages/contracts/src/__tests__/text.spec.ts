import { describe, expect, it } from 'vitest';
import {
  maskTarget,
  normalizeDigits,
  normalizePersianText,
  slugify,
  toPersianDigits,
} from '../text.js';

describe('normalizeDigits', () => {
  it('converts Persian digits to ASCII', () => {
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts mixed Persian digits inside text', () => {
    expect(normalizeDigits('سال ۱۴۰۳')).toBe('سال 1403');
  });

  it('leaves ASCII digits untouched', () => {
    expect(normalizeDigits('abc123')).toBe('abc123');
  });

  it('handles empty string', () => {
    expect(normalizeDigits('')).toBe('');
  });
});

describe('toPersianDigits', () => {
  it('converts ASCII digits to Persian', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
  });

  it('round-trips with normalizeDigits', () => {
    const s = '۰۹۱۲۳۴۵۶۷۸۹';
    expect(toPersianDigits(normalizeDigits(s))).toBe(s);
  });

  it('leaves non-digits untouched', () => {
    expect(toPersianDigits('ab-cd')).toBe('ab-cd');
  });

  it('converts mixed content', () => {
    expect(toPersianDigits('1a2b')).toBe('۱a۲b');
  });
});

describe('normalizePersianText', () => {
  it('maps Arabic yeh to Farsi yeh', () => {
    expect(normalizePersianText('\u064a')).toBe('\u06cc');
  });

  it('maps Arabic kaf to Farsi kaf', () => {
    expect(normalizePersianText('\u0643')).toBe('\u06a9');
  });

  it('maps tehs marbuta to heh', () => {
    expect(normalizePersianText('\u0629')).toBe('\u0647');
  });

  it('removes tatweel', () => {
    expect(normalizePersianText('کا\u0640\u0640\u0640فه')).toBe('کافه');
  });

  it('removes Arabic diacritics', () => {
    expect(normalizePersianText('س\u064e\u0650\u064fلام')).toBe('سلام');
  });

  it('removes superscript alef (U+0670)', () => {
    expect(normalizePersianText('م\u0670ی')).toBe('می');
  });

  it('collapses whitespace runs to a single space', () => {
    expect(normalizePersianText('a   b\tc\nd')).toBe('a b c d');
  });

  it('replaces NBSP with a single space', () => {
    expect(normalizePersianText('a\u00a0\u00a0b')).toBe('a b');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizePersianText('  سلام  ')).toBe('سلام');
  });

  it('collapses repeated ZWNJ to one', () => {
    expect(normalizePersianText('می\u200c\u200c\u200cروم')).toBe('می\u200cروم');
  });

  it('removes ZWNJ at word start and end', () => {
    expect(normalizePersianText('\u200cسلام\u200c')).toBe('سلام');
    expect(normalizePersianText('سلام \u200cدنیا')).toBe('سلام دنیا');
  });
});

describe('slugify', () => {
  it('slugifies Persian text with spaces', () => {
    expect(slugify('کافه کتاب')).toBe('کافه-کتاب');
  });

  it('lowercases Latin and replaces spaces with hyphens', () => {
    expect(slugify('My Cool Cafe')).toBe('my-cool-cafe');
  });

  it('replaces underscores and ZWNJ with hyphens', () => {
    expect(slugify('my_cool\u200ccafe')).toBe('my-cool-cafe');
  });

  it('strips characters outside Persian/Latin/digits/hyphen without inserting hyphens', () => {
    // Only spaces, ZWNJ and underscores become hyphens per the spec; other
    // punctuation is stripped outright.
    expect(slugify('café@#$%.tehran!')).toBe('caftehran');
  });

  it('collapses hyphen runs and trims edges', () => {
    expect(slugify('--a   b--')).toBe('a-b');
  });

  it('caps length at 80 chars', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it('returns empty string for punctuation-only input', () => {
    expect(slugify('***')).toBe('');
  });
});

describe('maskTarget (B1.4)', () => {
  it('masks E.164 phones keeping prefix and last 4 digits', () => {
    expect(maskTarget('+989123456789')).toBe('+9891***6789');
    expect(maskTarget('+12025550123')).toBe('+1202***0123');
  });

  it('masks emails keeping first char and domain', () => {
    expect(maskTarget('amir@example.com')).toBe('a***@example.com');
    expect(maskTarget('z@x.ir')).toBe('z***@x.ir');
  });

  it('fully masks unknown shapes', () => {
    expect(maskTarget('weird')).toBe('***');
    expect(maskTarget('@bad')).toBe('***');
    expect(maskTarget('')).toBe('***');
  });
});
