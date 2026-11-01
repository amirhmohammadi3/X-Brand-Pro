import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE_FALLBACK, FALLBACK_LANGUAGES, LOCALE_COOKIE } from './languages';

/**
 * Build-safe STATIC routing (F1.1). The runtime language list is dynamic
 * (`languages.ts` — rebuilt per request in the proxy from the cached API
 * response); this static object exists for next-intl's build plugin,
 * `generateStaticParams` and the navigation typing. `fa` has no URL prefix,
 * other locales are `/en/...` (AGENTS.md section 7, `localePrefix: as-needed`).
 *
 * `localeDetection: false` — visitors are never redirected by their
 * `Accept-Language` header; only the language switcher changes the language
 * (prompt F1.1). The choice persists in the `locale` cookie for one year
 * (httpOnly is intentionally NOT set: the switcher writes it client-side).
 */
export const routing = defineRouting({
  locales: FALLBACK_LANGUAGES.map((language) => language.code),
  defaultLocale: DEFAULT_LOCALE_FALLBACK,
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: {
    name: LOCALE_COOKIE,
    maxAge: 31_536_000, // one year, seconds
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
});

export type Locale = (typeof routing.locales)[number];
