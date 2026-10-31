import { getTranslations } from 'next-intl/server';

/**
 * Home placeholder (F0.1). Proves the token pipeline end to end: semantic
 * Tailwind classes only (bg-surface, text-muted, ring-ring), logical
 * properties (ms/me/ps/pe/s/e), and i18n keys from the seed messages. The
 * real map-centric home arrives in F3.3.
 */
export default async function HomePage() {
  const t = await getTranslations('home');

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-4 px-4 py-16 text-center sm:px-6">
      <h1 className="text-3xl font-semibold text-text sm:text-4xl">{t('title')}</h1>
      <p className="max-w-prose text-base leading-relaxed text-muted">{t('tagline')}</p>
      <div className="mt-4 flex items-center gap-3">
        <span className="rounded-s rounded-e bg-primary px-4 py-2 text-on-primary">{t('cta')}</span>
        <span className="border-s border-e border-border-subtle px-4 py-2 text-sm text-muted">
          {t('modeNote')}
        </span>
      </div>
    </main>
  );
}
