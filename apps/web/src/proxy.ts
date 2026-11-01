import createMiddleware from 'next-intl/middleware';
import type { NextRequest, NextResponse } from 'next/server';
import { LOCALE_COOKIE, getDefaultLocale, getLanguages } from './i18n/languages';

/**
 * Locale negotiation with a DYNAMIC language list (Next.js 16 "proxy"
 * convention — the file formerly known as middleware.ts, F1.1).
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

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const [languages, defaultLocale] = await Promise.all([getLanguages(), getDefaultLocale()]);
  const languageCodes = languages.map((language) => language.code);
  const signature = `${languageCodes.join(',')}|${defaultLocale}`;
  if (cachedHandler === null || cachedHandler.signature !== signature) {
    cachedHandler = buildHandler(languageCodes, defaultLocale);
  }

  // Unknown locales are not blocked here: next-intl forwards /<xx>/... as a
  // page path, the [locale] segment matches it, and the layout validates the
  // locale against the same dynamic list and renders a localized 404.
  return cachedHandler.handle(request);
}

export const config = {
  // Skip API routes, Next internals and all static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
