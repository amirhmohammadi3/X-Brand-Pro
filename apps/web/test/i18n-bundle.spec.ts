import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expandMessages,
  fetchMessagesFromApi,
  flattenMessages,
  loadLocaleMessages,
} from '../src/i18n/bundle-loader';

/** Read a dot path from the NESTED tree loadLocaleMessages returns. */
function pick(messages: Record<string, unknown>, path: string): unknown {
  let node: unknown = messages;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Bundle loader tests (F1.1): merge with the default locale for missing
 * keys, and fallback to the bundled seed copy when the API is unreachable
 * (mocked fetch — no network, AGENTS.md section 10).
 */

const API_OK = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

const bundleEnvelope = (
  locale: string,
  messages: Record<string, string>,
  version = 'ab12cd34ef56',
) => ({
  ok: true as const,
  data: { locale, version, messages },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flattenMessages', () => {
  it('flattens nested seed JSON into dot keys', () => {
    expect(flattenMessages({ a: { b: 'x' }, c: 'y' })).toEqual({ 'a.b': 'x', c: 'y' });
  });

  it('ignores non-string leaves (null, numbers, objects)', () => {
    expect(flattenMessages({ a: null, b: 3, c: { d: { e: 'x' } } })).toEqual({ 'c.d.e': 'x' });
  });
});

describe('expandMessages', () => {
  it('rebuilds the nested tree next-intl resolves through (flat → nested → flat round-trip)', () => {
    const flat = { 'home.hero.title': 'کشف', 'home.cta': 'شروع', 'common.save': 'ذخیره' };
    expect(pick(expandMessages(flat), 'home.hero.title')).toBe('کشف');
    expect(pick(expandMessages(flat), 'common.save')).toBe('ذخیره');
    expect(flattenMessages(expandMessages(flat))).toEqual(flat);
  });

  it('expands deep paths without clobbering sibling branches', () => {
    const flat = { 'a.b.c': '1', 'a.b.d': '2', 'a.e': '3' };
    const expanded = expandMessages(flat);
    expect(pick(expanded, 'a.b.c')).toBe('1');
    expect(pick(expanded, 'a.b.d')).toBe('2');
    expect(pick(expanded, 'a.e')).toBe('3');
  });
});

describe('fetchMessagesFromApi', () => {
  it('returns the messages on a valid envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => API_OK(bundleEnvelope('en', { 'home.cta': 'Get started' }))),
    );
    await expect(fetchMessagesFromApi('en')).resolves.toEqual({ 'home.cta': 'Get started' });
  });

  it('returns null (never throws) when the API is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(fetchMessagesFromApi('en')).resolves.toBeNull();
  });

  it('returns null on a schema-invalid payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => API_OK({ ok: true, data: { nope: true } })),
    );
    await expect(fetchMessagesFromApi('en')).resolves.toBeNull();
  });

  it('returns null on an HTTP error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(fetchMessagesFromApi('en')).resolves.toBeNull();
  });
});

describe('loadLocaleMessages', () => {
  it('merges the default-locale bundle under the requested locale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/i18n/messages/en')) {
          return API_OK(
            bundleEnvelope('en', { 'home.hero.title': 'Discover', 'home.cta': 'Get started' }),
          );
        }
        if (url.includes('/i18n/messages/fa')) {
          return API_OK(bundleEnvelope('fa', { 'home.hero.title': 'کشف', 'common.save': 'ذخیره' }));
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const messages = await loadLocaleMessages('en', 'fa');
    // en wins for its own keys; fa fills what en is missing:
    expect(pick(messages, 'home.hero.title')).toBe('Discover');
    expect(pick(messages, 'home.cta')).toBe('Get started');
    expect(pick(messages, 'common.save')).toBe('ذخیره');
  });

  it('falls back to the bundled seed copy when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const messages = await loadLocaleMessages('fa', 'fa');
    // Keys that exist in the API seed files (synced to src/i18n/fallback/):
    expect(pick(messages, 'common.loading')).toBeTruthy();
    expect(pick(messages, 'home.hero.title')).toBeTruthy();
    expect(pick(messages, 'a11y.skipToContent')).toBeTruthy();
  });

  it('falls back per locale when only the default locale bundle fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/i18n/messages/en')) throw new Error('boom');
        // A key that exists ONLY in this mocked fa bundle (not in the seed):
        return API_OK(bundleEnvelope('fa', { 'brand.only.in.api': 'مقدار' }));
      }),
    );
    const messages = await loadLocaleMessages('en', 'fa');
    // en from the bundled seed, default fa from the API:
    expect(pick(messages, 'brand.only.in.api')).toBe('مقدار');
    expect(pick(messages, 'common.loading')).toBeTruthy();
  });
});
