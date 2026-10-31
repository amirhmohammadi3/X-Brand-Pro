import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing skeleton (F0.1). The language RECORD (which languages exist,
 * their dir, enabled state) moves to the database and the API in phase 1
 * (B1.12/F1.1); until then this static list is the source of truth.
 * Default locale `fa` has no URL prefix; other locales are `/en/...`
 * (AGENTS.md section 7, `localePrefix: as-needed`).
 */
export const routing = defineRouting({
  locales: ['fa', 'en'],
  defaultLocale: 'fa',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];

export const LOCALE_META: Readonly<Record<Locale, { dir: 'rtl' | 'ltr'; name: string }>> = {
  fa: { dir: 'rtl', name: 'فارسی' },
  en: { dir: 'ltr', name: 'English' },
};

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
