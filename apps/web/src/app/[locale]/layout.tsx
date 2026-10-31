import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import '@fontsource-variable/vazirmatn';
import '@fontsource-variable/inter';
import '../globals.css';
import { LOCALE_META, routing } from '../../i18n/routing';

export const metadata: Metadata = {
  title: 'X-Brand skeleton',
  description: 'Temporary skeleton title — replaced by real branding and i18n in phase 1.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Root layout (lives under [locale] because every route is locale-scoped).
 * `lang`/`dir` come from the locale record; `data-theme`/`data-mode` are set
 * SERVER-side so there is no light/dark flash (DESIGN.md section 10). F0.1
 * pins the default pack and light mode; F1.2 wires the cookie-driven engine.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const dir = LOCALE_META[locale].dir;

  return (
    <html lang={locale} dir={dir} data-theme="modern" data-mode="light">
      <body className="min-h-dvh bg-bg font-sans text-text">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
