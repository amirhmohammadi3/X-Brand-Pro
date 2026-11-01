import { z } from 'zod';
import { languageListResponseSchema, localeCodeSchema, type Language } from '@app/contracts';
import { env } from '../lib/env';

/**
 * Language data (F1.1). The active language list lives in the database and is
 * served by the API (`GET /i18n/languages`, B1.12). The web app reads it with
 * a 60-second cache so a language an admin activates becomes routable within
 * a minute without a redeploy.
 *
 * Two cache layers on purpose:
 *  - the module-level memory cache below serves BOTH RSC and the proxy
 *    (Next.js 16 runs the proxy on the Node runtime, where Next's fetch Data
 *    Cache does not apply), so the API is hit at most once per minute per
 *    server instance;
 *  - the `fetch` options (`next.revalidate` + tag) additionally cache in the
 *    RSC Data Cache for server components.
 *
 * Failures are negative-cached for a few seconds only (a flaky API must not
 * add 3 s of timeout to every page view, but must also not lock a healthy
 * language list out for a full minute). While the API is unreachable the
 * build-safe FALLBACK_LANGUAGES keep fa/en rendering (prompt F1.1).
 */

export const DEFAULT_LOCALE_FALLBACK = 'fa';
/** Cookie persisting the visitor's language choice for one year (F1.1). */
export const LOCALE_COOKIE = 'locale';

const CACHE_TTL_MS = 60_000;
const FAILURE_TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 3_000;

/** Build-safe fallback used at build time and whenever the API is down. */
export const FALLBACK_LANGUAGES: readonly Language[] = [
  {
    code: 'fa',
    nameNative: 'فارسی',
    nameEn: 'Persian',
    dir: 'rtl',
    isDefault: true,
    isActive: true,
    sortOrder: 0,
  },
  {
    code: 'en',
    nameNative: 'English',
    nameEn: 'English',
    dir: 'ltr',
    isDefault: false,
    isActive: true,
    sortOrder: 10,
  },
];

function joinApi(path: string): string {
  const base = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

// Module-level mutable state: an intentional, documented cache (the prompt
// mandates an in-memory 60 s cache shared by RSC and proxy).
let languagesCache: { value: readonly Language[]; fetchedAt: number } | null = null;
let languagesFailedAt = 0;
let defaultLocaleCache: { value: string; fetchedAt: number } | null = null;
let defaultLocaleFailedAt = 0;

/** Test/infra hook — resets the module caches so tests start clean. */
export function clearI18nCaches(): void {
  languagesCache = null;
  languagesFailedAt = 0;
  defaultLocaleCache = null;
  defaultLocaleFailedAt = 0;
}

/**
 * Active languages, cached 60 s in memory. Never throws: while the API is
 * unreachable the build-safe fallback list is returned.
 */
export async function getLanguages(): Promise<readonly Language[]> {
  const now = Date.now();
  if (languagesCache && now - languagesCache.fetchedAt < CACHE_TTL_MS) {
    return languagesCache.value;
  }
  if (now - languagesFailedAt < FAILURE_TTL_MS) {
    return FALLBACK_LANGUAGES;
  }
  try {
    const response = await fetch(joinApi('/i18n/languages'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 60, tags: ['i18n:languages'] },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const envelope = z
      .object({ ok: z.literal(true), data: languageListResponseSchema })
      .safeParse(raw);
    if (!envelope.success) throw new Error('invalid languages envelope');
    const items = envelope.data.data.items.filter((language) => language.isActive);
    languagesCache = { value: items, fetchedAt: now };
    return items;
  } catch {
    languagesFailedAt = now;
    return FALLBACK_LANGUAGES;
  }
}

const publicSettingsSchema = z.object({
  'site.locale': z.union([localeCodeSchema, z.string()]).optional(),
});

/** Default locale from the public settings (`site.locale`), fallback `fa`. */
export async function getDefaultLocale(): Promise<string> {
  const now = Date.now();
  if (defaultLocaleCache && now - defaultLocaleCache.fetchedAt < CACHE_TTL_MS) {
    return defaultLocaleCache.value;
  }
  if (now - defaultLocaleFailedAt < FAILURE_TTL_MS) {
    return DEFAULT_LOCALE_FALLBACK;
  }
  try {
    const response = await fetch(joinApi('/settings/public'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 60, tags: ['settings:public'] },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const envelope = z.object({ ok: z.literal(true), data: z.record(z.unknown()) }).safeParse(raw);
    if (!envelope.success) throw new Error('invalid settings envelope');
    const parsed = publicSettingsSchema.safeParse(envelope.data.data);
    const value = parsed.success ? parsed.data['site.locale'] : undefined;
    const defaultLocale =
      value !== undefined && localeCodeSchema.safeParse(value).success
        ? value
        : DEFAULT_LOCALE_FALLBACK;
    defaultLocaleCache = { value: defaultLocale, fetchedAt: now };
    return defaultLocale;
  } catch {
    defaultLocaleFailedAt = now;
    return DEFAULT_LOCALE_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; the layout and proxy build on these).
// ---------------------------------------------------------------------------

/** A locale is routable when it is an ACTIVE language returned by the API. */
export function isKnownLocale(languages: readonly Language[], code: string): boolean {
  return languages.some((language) => language.isActive && language.code === code);
}

/**
 * Direction for a locale. Callers must first check `isKnownLocale`; the
 * fallback map keeps the helper total for the bundled default languages.
 */
export function localeDirection(languages: readonly Language[], code: string): 'rtl' | 'ltr' {
  const record = languages.find((language) => language.code === code);
  if (record) return record.dir;
  return code === 'fa' ? 'rtl' : 'ltr';
}

/**
 * Resolve the requested locale against the active list: unknown locales fall
 * back to the default so the 404 page itself renders with valid messages.
 */
export function resolveRequestedLocale(
  languages: readonly Language[],
  requested: string | undefined,
  defaultLocale: string,
): string {
  if (requested !== undefined && isKnownLocale(languages, requested)) return requested;
  return defaultLocale;
}
