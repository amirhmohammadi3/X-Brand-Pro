/**
 * Single source of truth for the product brand. Every other file imports from
 * here; scripts/check-brand.mjs fails the build if the name appears anywhere
 * else (except docs/, prompts/, this file, pnpm-lock.yaml and i18n seed JSON).
 */
export const BRAND = {
  nameFa: 'جاباز',
  nameEn: 'Jabaz',
  tagline: {
    fa: 'جاهای خوب را پیدا کن',
    en: 'Find the good places',
  },
  domain: 'jabaz.ir',
  supportEmail: 'support@jabaz.ir',
  logo: {
    mark: '/brand/mark.svg',
    wordmark: '/brand/wordmark.svg',
  },
} as const;

export const DEFAULT_LOCALE = 'fa' as const;
export const FALLBACK_LOCALE = 'en' as const;
