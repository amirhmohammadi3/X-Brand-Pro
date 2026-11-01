import { messageBundleSchema } from '@app/contracts';
import { z } from 'zod';
import { env } from '../lib/env';

/**
 * Message bundle loading for the web app (F1.1) — pure and framework-free so
 * it is unit-testable without Next.js. Order of preference per locale:
 *
 *  1. `GET /api/v1/i18n/messages/:locale` — fetched with Next's Data Cache
 *     (`next: { revalidate: 60, tags: ['i18n:<locale>'] }`). The API responds
 *     with a version-based `ETag`; Next's cache revalidates conditionally
 *     (304s) on its own, so no extra client-side ETag bookkeeping is needed.
 *  2. a bundled copy of the API seed files in `src/i18n/fallback/` (kept in
 *     sync by `scripts/sync-i18n-fallback.mjs`, run on `prebuild`), so the
 *     site still renders when the API is down.
 *
 * A locale bundle is merged over the DEFAULT locale bundle so missing keys
 * render the default-locale text (prompt F1.1). Revalidation is time-based
 * only — there is intentionally no `POST /api/revalidate-i18n` route handler.
 */

const FETCH_TIMEOUT_MS = 3_000;

function joinApi(path: string): string {
  const base = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Flattens nested seed JSON (`{ a: { b: "x" } }` → `{ "a.b": "x" }`).
 * Mirrors the API's `flattenMessages` (apps/api i18n.bundle.ts) — kept local
 * because cross-app imports are not allowed and contracts owns shared TYPES,
 * not API-internal helpers.
 */
export function flattenMessages(nested: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (nested === null || typeof nested !== 'object') return out;
  for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flattenMessages(value, path));
    } else if (typeof value === 'string') {
      out[path] = value;
    }
  }
  return out;
}

/**
 * Expands a flat dot-key record into the NESTED tree next-intl requires:
 * `t('hero.title')` inside `getTranslations('home')` resolves through the
 * object tree, so a flat `{ "home.hero.title": "…" }` bundle must be
 * re-nested before it is handed to next-intl (found by smoke test: a flat
 * bundle made every t() fall back to the key's last segment).
 */
export function expandMessages(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const segments = key.split('.');
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = node[segment];
      if (existing === undefined || typeof existing !== 'object' || existing === null) {
        const branch: Record<string, unknown> = {};
        node[segment] = branch;
        node = branch;
      } else {
        node = existing as Record<string, unknown>;
      }
    }
    const leaf = segments[segments.length - 1];
    if (leaf !== undefined) node[leaf] = value;
  }
  return root;
}

/**
 * Fetch one locale bundle from the API. Returns null on any failure (network,
 * timeout, non-envelope or schema-invalid payload) so the caller can fall
 * back; it never throws.
 */
export async function fetchMessagesFromApi(
  locale: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string> | null> {
  try {
    const response = await fetchImpl(joinApi(`/i18n/messages/${encodeURIComponent(locale)}`), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 60, tags: [`i18n:${locale}`] },
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    const envelope = z.object({ ok: z.literal(true), data: messageBundleSchema }).safeParse(raw);
    if (!envelope.success) return null;
    return envelope.data.data.messages;
  } catch {
    return null;
  }
}

/** Bundled seed copy for a locale (committed build artifact). */
export async function loadBundledMessages(locale: string): Promise<Record<string, string>> {
  const nested = (await import(`./fallback/${locale}.json`)).default;
  return flattenMessages(nested);
}

/**
 * Messages for one locale: API bundle (or bundled seed when the API is down),
 * merged over the default-locale messages so missing keys never render empty,
 * returned as the NESTED tree next-intl resolves through.
 */
export async function loadLocaleMessages(
  locale: string,
  defaultLocale: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const own =
    (await fetchMessagesFromApi(locale, fetchImpl)) ?? (await loadBundledMessages(locale));
  if (locale === defaultLocale) return expandMessages(own);
  const base =
    (await fetchMessagesFromApi(defaultLocale, fetchImpl)) ??
    (await loadBundledMessages(defaultLocale));
  return expandMessages({ ...base, ...own });
}
