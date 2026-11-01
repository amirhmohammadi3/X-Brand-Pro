import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Language } from '@app/contracts';
import {
  FALLBACK_LANGUAGES,
  clearI18nCaches,
  getDefaultLocale,
  getLanguages,
  isKnownLocale,
  localeDirection,
  resolveRequestedLocale,
} from '../src/i18n/languages';

/**
 * Language data tests (F1.1): the 404 rule for unknown locales, the
 * direction map built from language records, the 60 s in-memory cache and
 * the API-down fallback to the build-safe list (mocked fetch).
 */

const languagesEnvelope = (items: unknown) => ({ ok: true as const, data: { items } });

const row = (overrides: Partial<Language>): Language => ({
  code: 'xx',
  nameNative: 'Test',
  nameEn: 'Test',
  dir: 'ltr',
  isDefault: false,
  isActive: true,
  sortOrder: 100,
  ...overrides,
});

beforeEach(() => {
  clearI18nCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pure locale resolution', () => {
  const languages = [
    row({ code: 'fa', dir: 'rtl', isDefault: true, sortOrder: 0 }),
    row({ code: 'en', dir: 'ltr' }),
    row({ code: 'ar', dir: 'rtl' }),
    row({ code: 'de', dir: 'ltr', isActive: false }),
  ];

  it('maps direction from the language records', () => {
    expect(localeDirection(languages, 'fa')).toBe('rtl');
    expect(localeDirection(languages, 'en')).toBe('ltr');
    expect(localeDirection(languages, 'ar')).toBe('rtl');
  });

  it('rejects unknown and INACTIVE locales (the localized 404 rule)', () => {
    expect(isKnownLocale(languages, 'fa')).toBe(true);
    expect(isKnownLocale(languages, 'ar')).toBe(true);
    expect(isKnownLocale(languages, 'de')).toBe(false); // inactive
    expect(isKnownLocale(languages, 'fr')).toBe(false); // unknown
  });

  it('resolves unknown requests to the default locale', () => {
    expect(resolveRequestedLocale(languages, 'ar', 'fa')).toBe('ar');
    expect(resolveRequestedLocale(languages, 'de', 'fa')).toBe('fa');
    expect(resolveRequestedLocale(languages, 'fr', 'fa')).toBe('fa');
    expect(resolveRequestedLocale(languages, undefined, 'fa')).toBe('fa');
  });
});

describe('getLanguages', () => {
  it('returns the active languages from the API', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify(languagesEnvelope([row({ code: 'fa', dir: 'rtl' }), row({ code: 'en' })])),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const languages = await getLanguages();
    expect(languages.map((language) => language.code)).toEqual(['fa', 'en']);
  });

  it('caches for 60 seconds (second call does not refetch)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(languagesEnvelope([row({ code: 'fa', dir: 'rtl' })])), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await getLanguages();
    await getLanguages();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // After 61 s the cache expires and the API is hit again:
    vi.setSystemTime(new Date('2026-11-01T12:01:01Z'));
    await getLanguages();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the build-safe list when the API is down (without caching the failure)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await getLanguages()).toEqual(FALLBACK_LANGUAGES);
    expect(FALLBACK_LANGUAGES.map((language) => language.code)).toEqual(['fa', 'en']);
    // Recovery within the failure window once the API is healthy again:
    vi.setSystemTime(new Date('2026-11-01T12:00:06Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(languagesEnvelope([row({ code: 'fa', dir: 'rtl' })])), {
            status: 200,
          }),
      ),
    );
    expect((await getLanguages()).map((language) => language.code)).toEqual(['fa']);
  });
});

describe('getDefaultLocale', () => {
  it('reads site.locale from the public settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, data: { 'site.locale': 'en', 'site.name': 'X' } }),
            {
              status: 200,
            },
          ),
      ),
    );
    await expect(getDefaultLocale()).resolves.toBe('en');
  });

  it('falls back to fa when the API is down or the value is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(getDefaultLocale()).resolves.toBe('fa');

    clearI18nCaches();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, data: { 'site.locale': 'not a locale!' } }), {
            status: 200,
          }),
      ),
    );
    await expect(getDefaultLocale()).resolves.toBe('fa');
  });
});
