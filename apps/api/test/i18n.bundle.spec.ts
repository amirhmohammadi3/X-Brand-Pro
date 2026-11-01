import { describe, expect, it } from 'vitest';
import {
  computeBundleVersion,
  containsHtml,
  composeWithFallback,
  filterByNamespaces,
  flattenMessages,
  interpolate,
  sanitizeTranslationValue,
} from '../src/modules/i18n/i18n.bundle.js';

describe('i18n bundle helpers (B1.12)', () => {
  it('flattenMessages flattens nested seed JSON to dot keys', () => {
    const flat = flattenMessages({
      common: { save: 'Save', group: { deep: 'X' } },
      errors: { not_found: '404' },
    });
    expect(flat).toEqual({
      'common.save': 'Save',
      'common.group.deep': 'X',
      'errors.not_found': '404',
    });
  });

  it('flattenMessages ignores non-string leaves', () => {
    expect(flattenMessages({ a: { b: 1, c: null, d: 'ok' } })).toEqual({ 'a.d': 'ok' });
  });

  it('composeWithFallback fills missing keys from the default and never invents keys', () => {
    const composed = composeWithFallback({ 'a.one': '1', 'a.two': '2' }, { 'a.two': 'dos' });
    expect(composed).toEqual({ 'a.one': '1', 'a.two': 'dos' });
    expect(composed['a.missing']).toBeUndefined();
  });

  it('filterByNamespaces keeps only requested first segments (null = all)', () => {
    const messages = { 'common.save': 's', 'auth.login.title': 't', 'errors.forbidden': 'f' };
    expect(filterByNamespaces(messages, ['common'])).toEqual({ 'common.save': 's' });
    expect(Object.keys(filterByNamespaces(messages, ['common', 'auth']))).toEqual([
      'common.save',
      'auth.login.title',
    ]);
    expect(filterByNamespaces(messages, null)).toEqual(messages);
  });

  it('computeBundleVersion is stable, 12 hex chars, and changes when a value changes', () => {
    const a = computeBundleVersion({ 'x.y': 'one', 'a.b': 'two' });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(computeBundleVersion({ 'a.b': 'two', 'x.y': 'one' })).toBe(a);
    const changed = computeBundleVersion({ 'a.b': 'two', 'x.y': 'ONE' });
    expect(changed).not.toBe(a);
    expect(changed).toMatch(/^[0-9a-f]{12}$/);
  });

  it('computeBundleVersion changes when a key is added', () => {
    const base = computeBundleVersion({ 'a.b': 'x' });
    expect(computeBundleVersion({ 'a.b': 'x', 'a.c': 'y' })).not.toBe(base);
  });

  it('sanitizeTranslationValue strips control characters but keeps \\n and \\t', () => {
    expect(sanitizeTranslationValue('a\u0000b\u001Fc')).toBe('abc');
    expect(sanitizeTranslationValue('line\nkeep\ttab')).toBe('line\nkeep\ttab');
    expect(sanitizeTranslationValue('پارسی ✓')).toBe('پارسی ✓');
  });

  it('containsHtml detects tags but allows ICU-style placeholders', () => {
    expect(containsHtml('<b>bold</b>')).toBe(true);
    expect(containsHtml('hello <script>alert(1)</script>')).toBe(true);
    expect(containsHtml('Hello {name}, you have {count} items')).toBe(false);
    expect(containsHtml('۱ < ۲ و ۳ > ۲')).toBe(false);
  });

  it('interpolate replaces {var} placeholders; unknown vars become empty', () => {
    expect(interpolate('Hello {name}', { name: 'Amir' })).toBe('Hello Amir');
    expect(interpolate('Hello {name}', { name: 42 })).toBe('Hello 42');
    expect(interpolate('Hi {missing}', { other: 'x' })).toBe('Hi ');
    expect(interpolate('No vars here')).toBe('No vars here');
  });
});
