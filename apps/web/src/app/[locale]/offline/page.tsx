import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container } from '../../../components/layout/container';
import { Link } from '../../../i18n/navigation';

/**
 * Offline fallback page (F5.4). Served by the service worker when a
 * navigation request fails (no network / flaky captive portal). It is a
 * server component so it renders identically on first paint and on every
 * SW fallback — the SW precaches `/fa/offline` and `/en/offline` at install
 * time, so the page exists in cache before it is ever needed.
 *
 * The page is intentionally tiny and link-free except for a "try again"
 * button: any client-side navigation would itself need the network, so the
 * retry is a hard reload via a plain `<a>` (the SW re-runs `handleNavigation`
 * and, if the network has returned, serves the real page).
 */
export const dynamic = 'force-static';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pwa.offline');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations('pwa.offline');
  return (
    <Container className="flex min-h-dvh flex-col items-center justify-center py-16 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-text">{t('title')}</h1>
        <p className="text-text-subtle">{t('body')}</p>
        {/* Plain anchor: a hard reload re-runs the SW navigation handler,
            which retries the network and serves the real page on success. */}
        <Link
          href="/"
          className="inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-on-primary"
        >
          {t('retry')}
        </Link>
      </div>
    </Container>
  );
}
