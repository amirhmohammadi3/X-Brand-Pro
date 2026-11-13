import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Container } from '../../components/layout/container';
import { EmptyState } from '../../components/ui/empty-state';
import { Compass } from 'lucide-react';

/**
 * 404 page (F1.7). Rendered by Next.js when no route matches.
 *
 * The home link is a plain `<Link>` styled with the Button primary classes
 * (not `<Button asChild><Link>`) because this is a SERVER component and
 * `Button`'s `onClick` handler cannot be passed across the server→client
 * boundary — Next refuses to serialize it during static prerender. The
 * visual is identical; the interactivity (client-side navigation) is the
 * Link's own.
 */
export default async function NotFound() {
  const t = await getTranslations('layout');
  return (
    <Container className="flex min-h-[60vh] items-center justify-center py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <EmptyState
          icon={Compass}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
        />
        <Link
          href="/"
          className="inline-flex h-[var(--control-h)] items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('backToHome')}
        </Link>
      </div>
    </Container>
  );
}
