import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { isApiRequestError } from '../../lib/api/errors';
import { Button } from './button';
import { Text } from './text';

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** An ApiRequestError thrown by the API client, or a plain string message. */
  error: unknown;
  /** Retry handler; when present a retry button is rendered. */
  onRetry?: () => void;
}

/**
 * `ErrorState` (F1.3). Renders a friendly failure surface from an
 * `ApiRequestError` or a plain string: the message, an optional retry button
 * and the request id in muted small text (so support can trace it). The
 * visible message comes from the error; the retry label and the "error"
 * heading are i18n keys (`ui.retry`, `ui.error`).
 */
export function ErrorState({ error, onRetry, className, ...rest }: ErrorStateProps) {
  const t = useTranslations('ui');

  let message: string;
  let requestId: string | undefined;
  if (isApiRequestError(error)) {
    message = error.message;
    requestId = error.requestId;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = t('error');
  }

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 py-12 text-center', className)}
      {...rest}
    >
      <AlertTriangle aria-hidden className="h-10 w-10 text-danger" />
      <p className="text-base font-medium text-text">{message}</p>
      {requestId ? (
        <Text as="p" size="xs" muted>
          {t('requestId', { id: requestId })}
        </Text>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}
