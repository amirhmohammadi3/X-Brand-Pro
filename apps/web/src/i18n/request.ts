import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * Server-side i18n request config (F0.1 skeleton). Messages load from the
 * local JSON seed files so the app is self-contained; prompt F1.1 replaces
 * this file's loader with API-provided messages (next-intl keeps the same
 * interface). Never hard-code user-facing text in components — add keys to
 * BOTH seed files instead (AGENTS.md section 8).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
