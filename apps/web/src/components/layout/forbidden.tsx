import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Container } from './container';
import { EmptyState } from '../ui/empty-state';
import { Button } from '../ui/button';
import { ShieldAlert } from 'lucide-react';

/**
 * `Forbidden` (F1.7). The 403 body used by role-guarded layouts. Rendered
 * in place (not a redirect) so the user understands why access was denied.
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
        <Button variant="primary" asChild>
          <Link href="/">{t('backToHome')}</Link>
        </Button>
      </div>
    </Container>
  );
}
