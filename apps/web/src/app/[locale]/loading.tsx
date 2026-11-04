import { getTranslations } from 'next-intl/server';
import { Container } from '../../components/layout/container';

/**
 * Global loading skeleton (F1.7). Shown by Next.js while a route segment's
 * server data is loading.
 */
export default async function Loading() {
  const t = await getTranslations('layout');
  return (
    <Container className="flex min-h-[40vh] items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="text-sm text-text-subtle">{t('loading')}</span>
      </div>
    </Container>
  );
}
