import createMiddleware from 'next-intl/middleware';
import type { NextRequest, NextResponse } from 'next/server';
import { LOCALE_COOKIE, getDefaultLocale, getLanguages } from './i18n/languages';
import { env } from './lib/env';
import {
  mergeRequestCookies,
  needsSessionRefresh,
  parseSetCookiePair,
  REFRESH_COOKIE,
} from './lib/auth/session-refresh';

/**
 * Locale negotiation + session refresh (Next.js 16 "proxy" convention — the
 * file formerly known as middleware.ts; locale part F1.1, refresh F1.8).
 *
 * The active languages come from `GET /i18n/languages` (60 s in-memory cache
 * in languages.ts) and the default locale from `GET /settings/public`
 * (`site.locale`); while the API is unreachable the build-safe fa/en fallback
 * keeps the site working. The next-intl handler is rebuilt only when the
 * language list or default locale actually changes.
 *
 * `localeDetection: false` — no Accept-Language redirects; the visitor's
 * choice persists in the `locale` cookie (1 year). An unknown locale is NOT
 * blocked here: the request falls through to the [locale] layout, which
 * renders a proper localized 404 via notFound().
 *
 * Session refresh (F1.8): server-rendered pages are only as fresh as the
 * request's `at` cookie. When a page request carries a refresh cookie `rt`
 * but a missing/expired access cookie `at`, the proxy makes ONE server-side
 * `POST /api/v1/auth/refresh` (forwarding the `rt`), then:
 *   1. appends the API's raw `Set-Cookie` headers to the BROWSER response
 *      (works for both rendered and redirected responses), and
 *   2. merges the new `at`/`rt` values into the CURRENT request's cookies so
 *      server components (`GET /auth/me` in the layouts) see the fresh
 *      session without an extra client round-trip.
 * Failures (API down, 401, CSRF, timeout) change nothing — the visitor
 * simply stays anonymous. There is no loop: the refresh call goes directly
 * to the API origin, and the matcher never matches API routes. The same
 * header pass stamps `x-pathname` so route-group layouts can build correct
 * `?next=` redirects (F1.7 best-effort referer parsing is the fallback).
 */

type CachedHandler = {
  signature: string;
  handle: (request: NextRequest) => NextResponse | Promise<NextResponse>;
};

let cachedHandler: CachedHandler | null = null;

function buildHandler(languageCodes: readonly string[], defaultLocale: string): CachedHandler {
  const handle = createMiddleware({
    locales: [...languageCodes],
    defaultLocale,
    localePrefix: 'as-needed',
    localeDetection: false,
    localeCookie: {
      name: LOCALE_COOKIE,
      maxAge: 31_536_000, // one year, seconds
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  });
  return { signature: `${languageCodes.join(',')}|${defaultLocale}`, handle };
}

const REFRESH_TIMEOUT_MS = 3_000;

/**
 * One-shot server-side refresh. Mutates `request` cookies in place when the
 * API answered with fresh cookies; returns the raw `Set-Cookie` lines to
 * append to the browser response (empty on any failure).
 */
async function refreshSessionCookies(request: NextRequest): Promise<ReadonlyArray<string>> {
  const rt = request.cookies.get(REFRESH_COOKIE)?.value;
  const at = request.cookies.get('at')?.value;
  if (!needsSessionRefresh(rt, at, Math.floor(Date.now() / 1_000))) return [];

  const apiBase = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  try {
    const apiResponse = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Cookie: `rt=${rt ?? ''}`,
        // The API's CSRF guard requires cookie-bearing unsafe requests to
        // carry the web origin; page navigations themselves carry no Origin.
        Origin: request.nextUrl.origin,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!apiResponse.ok) return []; // failure → clear nothing, continue as-is
    const raw = apiResponse.headers.getSetCookie();
    const pairs: Array<{ name: string; value: string }> = [];
    for (const line of raw) {
      const pair = parseSetCookiePair(line);
      if (pair !== null && pair.value.length > 0) pairs.push(pair);
    }
    if (pairs.length === 0) return [];

    // Request side: fresh cookies for server components in THIS render.
    const merged = mergeRequestCookies(request.headers.get('cookie'), pairs);
    request.headers.set('cookie', merged);
    return raw;
  } catch {
    return []; // network/timeout → anonymous, never loop, never retry here
  }
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const [languages, defaultLocale] = await Promise.all([getLanguages(), getDefaultLocale()]);
  const languageCodes = languages.map((language) => language.code);
  const signature = `${languageCodes.join(',')}|${defaultLocale}`;
  if (cachedHandler === null || cachedHandler.signature !== signature) {
    cachedHandler = buildHandler(languageCodes, defaultLocale);
  }

  // Downstream layouts read the original path for `?next=` redirects.
  request.headers.set('x-pathname', request.nextUrl.pathname);

  const setCookies = await refreshSessionCookies(request);

  // Unknown locales are not blocked here: next-intl forwards /<xx>/... as a
  // page path, the [locale] segment matches it, and the layout validates the
  // locale against the same dynamic list and renders a localized 404.
  const response = await cachedHandler.handle(request);
  for (const cookie of setCookies) {
    // Browser side: verbatim API cookie attributes (httpOnly, SameSite, …).
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

export const config = {
  // Skip API routes, Next internals and all static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
