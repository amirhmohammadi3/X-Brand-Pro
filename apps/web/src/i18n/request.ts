import { getRequestConfig } from 'next-intl/server';
import { getDefaultLocale, getLanguages, resolveRequestedLocale } from './languages';
import { loadLocaleMessages } from './bundle-loader';

/**
 * next-intl request config (F1.1). The locale is validated against the
 * ACTIVE language list from the API (60 s cache, see languages.ts); unknown
 * locales resolve to the default locale here — the [locale] layout is the
 * place that renders a 404 for them. Messages come from the API bundle with
 * a bundled seed fallback (bundle-loader.ts).
 *
 * Missing-key behavior (prompt F1.1):
 *  - development: a warning is logged and the KEY is displayed;
 *  - production: the default-locale text (via the merge in loadLocaleMessages)
 *    or, as the last resort, the key's last segment — never an empty string;
 *    console noise is suppressed in production.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const [languages, defaultLocale] = await Promise.all([getLanguages(), getDefaultLocale()]);
  const locale = resolveRequestedLocale(languages, requested, defaultLocale);
  const messages = await loadLocaleMessages(locale, defaultLocale);

  return {
    locale,
    messages,
    onError: (error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] ${error.code}: ${error.message}`);
      }
    },
    getMessageFallback: ({ key }) => {
      if (process.env.NODE_ENV === 'development') return key;
      const last = key.split('.').pop();
      return last !== undefined && last.length > 0 ? last : key;
    },
  };
});
