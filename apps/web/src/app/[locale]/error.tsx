'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Container } from '../../components/layout/container';
import { ErrorState } from '../../components/ui/error-state';
import { Button } from '../../components/ui/button';

/**
 * Global error boundary (F1.7). Catches unhandled errors in any route
 * segment under `[locale]`. Renders the shared `ErrorState` with a retry
 * button that re-runs the failed segment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('layout');
  useEffect(() => {
    // In production this would forward to the error reporter (F1.9).
    if (process.env.NODE_ENV !== 'production') {
      console.error('route error:', error);
    }
  }, [error]);

  return (
    <Container className="flex min-h-[60vh] items-center justify-center py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <ErrorState error={error} onRetry={reset} />
        <Button variant="ghost" asChild>
          <a href="/">{t('backToHome')}</a>
        </Button>
      </div>
    </Container>
  );
}
