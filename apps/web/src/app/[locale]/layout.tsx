import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
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
import { getActiveTheme, type ResolvedTheme } from '../../lib/theme/server';
import { tokensToCss } from '../../lib/theme/tokens-to-css';
import {
  MODE_COOKIE,
  parseModeCookie,
  resolveServerMode,
  SYSTEM_MODE_INLINE_SCRIPT,
} from '../../lib/theme/mode';
import { ActiveThemeProvider } from '../../lib/theme/active-theme-context';
import { PwaBootstrap } from '../../components/pwa/pwa-bootstrap';

/**
 * Build-time prerender covers the build-safe fallback locales; languages an
 * admin activates later render on demand (dynamicParams) within the 60 s
 * cache window (prompt F1.1).
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return FALLBACK_LANGUAGES.map((language) => ({ locale: language.code }));
}

/**
 * Per-request metadata: the `theme-color` meta follows the active pack's
 * `bg` token (DESIGN.md section 10). Title/description are placeholders
 * replaced by real branding in a later prompt. F5.4 links the locale-scoped
 * manifest (`/[locale]/manifest.webmanifest`) the SW precaches icons for and
 * registers the apple-touch icon for iOS Safari «Add to Home Screen».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const theme = await getActiveTheme();
  return {
    title: 'X-Brand skeleton',
    description: 'Temporary skeleton title — replaced by real branding and i18n in phase 1.',
    other: { 'theme-color': theme.tokens.light.bg },
    manifest: `/${locale}/manifest.webmanifest`,
    icons: {
      icon: [
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: '/icons/icon-192.png', sizes: '192x192' }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'X-Brand',
    },
  };
}

/** Per-request viewport: width + the same theme-color as metadata. */
export function generateViewport(): Viewport {
  return { width: 'device-width', initialScale: 1 };
}

/**
 * Root layout (lives under [locale] because every route is locale-scoped).
 * The active theme pack + mode are resolved SERVER-side and injected as:
 *  - a single inline `<style id="theme-vars">` with the pack's CSS variables
 *    for both modes (generated from validated tokens — the ONLY permitted
 *    use of dangerouslySetInnerHTML, defensively escaped);
 *  - `data-theme`, `data-mode`, `data-mode-pref`, `data-card`, `data-header`,
 *    `data-density` on `<html>` (no flash, DESIGN.md section 10);
 *  - a tiny blocking inline script in `<head>` that corrects `data-mode` from
 *    `prefers-color-scheme` when the preference is `system`.
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

  // Resolve the active theme (API or bundled fallback) and the visitor's mode.
  const theme: ResolvedTheme = await getActiveTheme();
  const cookieStore = await cookies();
  const modePref = parseModeCookie(cookieStore.get(MODE_COOKIE)?.value);
  const resolvedMode = resolveServerMode(modePref);
  const cssText = tokensToCss(theme.tokens);

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme={theme.packId}
      data-mode={resolvedMode}
      data-mode-pref={modePref}
      data-card={theme.layout.card}
      data-header={theme.layout.header}
      data-density={theme.density}
    >
      <head>
        {/* Blocking, before first paint. Static constant (see mode.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_MODE_INLINE_SCRIPT }} />
        {/* The pack's CSS variables for both modes. Escaped in tokensToCss. */}
        <style id="theme-vars" dangerouslySetInnerHTML={{ __html: cssText }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-text">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
        >
          {t('skipToContent')}
        </a>
        <ActiveThemeProvider value={{ packId: theme.packId, tokens: theme.tokens, resolvedMode }}>
          <Providers>
            <NextIntlClientProvider>{children}</NextIntlClientProvider>
          </Providers>
        </ActiveThemeProvider>
        {/* F5.4: registers /sw.js in production + surfaces the install banner.
            Rendered outside the main content so it never shifts layout. */}
        <PwaBootstrap />
      </body>
    </html>
  );
}
