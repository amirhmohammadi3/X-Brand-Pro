import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import '@fontsource-variable/vazirmatn';
import '@fontsource-variable/inter';
import '../globals.css';
import { Providers } from '../providers';
import {
  FALLBACK_LANGUAGES,
  getLanguages,
  isKnownLocale,
  localeDirection,
} from '../../i18n/languages';

export const metadata: Metadata = {
  title: 'X-Brand skeleton',
  description: 'Temporary skeleton title — replaced by real branding and i18n in phase 1.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Build-time prerender covers the build-safe fallback locales; languages an
 * admin activates later render on demand (dynamicParams) within the 60 s
 * cache window (prompt F1.1).
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return FALLBACK_LANGUAGES.map((language) => ({ locale: language.code }));
}

/**
 * Root layout (lives under [locale] because every route is locale-scoped).
 * `lang`/`dir` come from the dynamic LANGUAGE RECORD (F1.1 — not a static
 * map); a locale that is not an active language renders the localized 404.
 * `data-theme`/`data-mode` are set SERVER-side so there is no light/dark
 * flash (DESIGN.md section 10). F0.1 pins the default pack and light mode;
 * F1.2 wires the cookie-driven engine.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const languages = await getLanguages();
  if (!isKnownLocale(languages, locale)) {
    notFound();
  }
  const dir = localeDirection(languages, locale);
  const t = await getTranslations('a11y');

  return (
    <html lang={locale} dir={dir} data-theme="modern" data-mode="light">
      <body className="min-h-dvh bg-bg font-sans text-text">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
        >
          {t('skipToContent')}
        </a>
        <Providers>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
