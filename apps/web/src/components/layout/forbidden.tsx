import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Container } from './container';
import { EmptyState } from '../ui/empty-state';
import { ShieldAlert } from 'lucide-react';

/**
 * `Forbidden` (F1.7). The 403 body used by role-guarded layouts. Rendered
 * in place (not a redirect) so the user understands why access was denied.
 *
 * The home link is a plain `<Link>` styled with the Button primary classes
 * (not `<Button asChild><Link>`) because this is a SERVER component and
 * `Button`'s `onClick` handler cannot be passed across the server→client
 * boundary. See `[locale]/not-found.tsx` for the same fix.
 */
export async function Forbidden() {
  const t = await getTranslations('layout');
  return (
    <Container className="flex min-h-[60vh] items-center justify-center py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <EmptyState
          icon={ShieldAlert}
          title={t('forbiddenTitle')}
          description={t('forbiddenDescription')}
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
