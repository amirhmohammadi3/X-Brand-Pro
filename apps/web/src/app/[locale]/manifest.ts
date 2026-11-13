import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';
import { getActiveTheme } from '../../lib/theme/server';

/**
 * Web App Manifest (F5.4). Served by Next at `/<locale>/manifest.webmanifest`
 * and auto-linked in `<head>`. The manifest is locale-scoped so the
 * `name`/`short_name`/`description` follow the active language and the
 * `lang`/`dir` hints tell the installed shell how to render before the SW
 * hydrates. Icons are served from `/icons/*` (same origin, no external image
 * host — AGENTS.md section 7); the SVG maskable icon scales cleanly across
 * Android adaptive, iOS Safari pinned and desktop install surfaces.
 *
 * `display: 'standalone'` keeps the browser chrome hidden on install (the
 * desired PWA shell); `start_url` carries `?source=pwa` so server-side
 * analytics (B7.1 impression events) can attribute cold-start sessions to
 * the installed surface without a separate tracker.
 *
 * `theme_color`/`background_color` come from the active theme pack's `bg`
 * token (DESIGN.md section 10) — they MUST match the inline `<style
 * id="theme-vars">` the layout injects so the launch splash does not flash a
 * different color from the first paint.
 */
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('pwa');
  const theme = await getActiveTheme();
  return {
    name: t('name'),
    short_name: t('shortName'),
    description: t('description'),
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: theme.tokens.light.bg,
    theme_color: theme.tokens.light.bg,
    // Both `fa` and `en` exist at build time (FALLBACK_LANGUAGES); the route
    // is locale-scoped so Next stamps the matching pair per manifest.
    lang: 'fa',
    dir: 'rtl',
    categories: ['shopping', 'lifestyle', 'social'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: t('shortcutSearch'),
        url: '/search?source=pwa',
      },
      {
        name: t('shortcutFavorites'),
        url: '/account/favorites?source=pwa',
      },
    ],
  };
}
