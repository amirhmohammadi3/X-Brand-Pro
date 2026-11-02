import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearActiveThemeCache, getActiveTheme, FALLBACK_PACK } from '../src/lib/theme/server';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  clearActiveThemeCache();
  vi.restoreAllMocks();
});

describe('getActiveTheme fallback', () => {
  it('returns the bundled modern pack when the API is unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    clearActiveThemeCache();

    const theme = await getActiveTheme();
    expect(theme.fallback).toBe(true);
    expect(theme.packId).toBe('modern');
    expect(theme.packName).toBe(FALLBACK_PACK.names.fa);
    expect(theme.tokens.light.bg).toBe('#F6F7FB');
    expect(theme.layout.card).toBe('outlined');
    expect(theme.density).toBe('compact');
  });

  it('returns the bundled fallback on a non-200 response', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    clearActiveThemeCache();

    const theme = await getActiveTheme();
    expect(theme.fallback).toBe(true);
    expect(theme.packId).toBe('modern');
  });

  it('returns the bundled fallback on an invalid envelope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ not: 'an envelope' }),
    }) as unknown as typeof fetch;
    clearActiveThemeCache();

    const theme = await getActiveTheme();
    expect(theme.fallback).toBe(true);
  });

  it('uses the API pack when the envelope is valid', async () => {
    const apiPayload = {
      ok: true,
      data: {
        pack: {
          id: 'warm',
          names: { fa: 'گرم', en: 'Warm' },
          tokens: FALLBACK_PACK.tokens, // any valid tokens
        },
        version: 'v-1700000000',
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => apiPayload,
    }) as unknown as typeof fetch;
    clearActiveThemeCache();

    const theme = await getActiveTheme();
    expect(theme.fallback).toBe(false);
    expect(theme.packId).toBe('warm');
    expect(theme.version).toBe('v-1700000000');
  });

  it('caches a successful result for subsequent calls within the window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          pack: {
            id: 'luxe',
            names: { fa: 'لوکس', en: 'Luxe' },
            tokens: FALLBACK_PACK.tokens,
          },
          version: 'v-luxe-1',
        },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    clearActiveThemeCache();

    await getActiveTheme();
    await getActiveTheme();
    await getActiveTheme();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
