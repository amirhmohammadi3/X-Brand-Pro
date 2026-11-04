import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Container } from '../../components/layout/container';
import { EmptyState } from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { Compass } from 'lucide-react';

/**
 * 404 page (F1.7). Rendered by Next.js when no route matches.
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
        <Button variant="primary" asChild>
          <Link href="/">{t('backToHome')}</Link>
        </Button>
      </div>
    </Container>
  );
}
