import { getLocale, getTranslations } from 'next-intl/server';
import { createFormatters } from '../../../lib/format';

/**
 * Home placeholder (F0.1, keys reworked in F1.1 to `home.hero.*`). Proves the
 * token pipeline end to end: semantic Tailwind classes only (bg-surface,
 * text-muted, ring-ring), logical properties (ms/me/ps/pe/s/e), and i18n keys
 * from the API bundle. The real map-centric home arrives in F3.3.
 */
export default async function HomePage() {
  const t = await getTranslations('home');
  const tA11y = await getTranslations('a11y');
  const locale = await getLocale();
  const { formatNumber } = createFormatters(locale);

  return (
    <main
      id="main"
      aria-label={tA11y('mainContent')}
      className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-4 px-4 py-16 text-center sm:px-6"
    >
      <h1 className="text-3xl font-semibold text-text sm:text-4xl">{t('hero.title')}</h1>
      <p className="max-w-prose text-base leading-relaxed text-muted">{t('hero.subtitle')}</p>
      <div className="mt-4 flex items-center gap-3">
        <span className="rounded-s rounded-e bg-primary px-4 py-2 text-on-primary">{t('cta')}</span>
        <span className="border-s border-e border-border-subtle px-4 py-2 text-sm text-muted">
          {formatNumber(1234)}
        </span>
      </div>
    </main>
  );
}
