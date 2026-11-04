'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { forgotPasswordBodySchema } from '@app/contracts';
import { isApiRequestError } from '../../lib/api/errors';
import { useForgotPassword } from '../../lib/api/auth';
import { retryAfterSec } from './api-error';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useCountdown } from '../../lib/use-countdown';
import { createFormatters } from '../../lib/format';
import { AuthCard } from './auth-card';
import { IdentifierField } from './identifier-field';
import { Button } from '../ui';

/** sessionStorage key the reset page reads the identifier back from. */
export const RESET_IDENTIFIER_KEY = 'auth.reset-identifier';

/**
 * `ForgotForm` (F1.8) — the `/forgot-password` page body.
 *
 * Step 1 asks for the identifier (username, email or phone) and requests a
 * reset code. Step 2 is a GENERIC confirmation screen: it never reveals
 * whether the account exists (anti-enumeration — the API answers
 * `{ ok: true }` regardless). The identifier travels to `/reset-password`
 * through the query string AND sessionStorage so a reload keeps it.
 *
 * Rate limiting (`429` + `retryAfterSec`) arms a visible countdown.
 */
export function ForgotForm() {
  const t = useTranslations('auth.forgot');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const forgot = useForgotPassword();

  const [identifier, setIdentifier] = useState('');
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const waitCountdown = useCountdown();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setIdentifierError(null);
    const parsed = forgotPasswordBodySchema.safeParse({ identifier });
    if (!parsed.success) {
      setIdentifierError(tRoot('validation.required'));
      return;
    }
    setSubmitting(true);
    try {
      await forgot.mutateAsync(parsed.data);
      try {
        sessionStorage.setItem(RESET_IDENTIFIER_KEY, parsed.data.identifier);
      } catch {
        // sessionStorage unavailable (privacy mode) — the query param still works
      }
      setSent(true);
    } catch (err) {
      if (isApiRequestError(err) && err.code === 'RATE_LIMITED') {
        waitCountdown.start(retryAfterSec(err) ?? 60);
      }
      setFormError(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title={t('confirmTitle')}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-subtle">{t('confirmDescription')}</p>
          <Button variant="primary" asChild>
            <Link href={`/reset-password?identifier=${encodeURIComponent(identifier.trim())}`}>
              {t('goReset')}
            </Link>
          </Button>
          <div className="text-sm">
            <Link
              href="/login"
              className="text-text-subtle underline-offset-4 hover:text-text hover:underline"
            >
              {t('backToLogin')}
            </Link>
          </div>
        </div>
      </AuthCard>
    );
  }

  const waiting = waitCountdown.remaining > 0;

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <IdentifierField
          label={t('identifierLabel')}
          value={identifier}
          onChange={setIdentifier}
          error={identifierError ?? undefined}
          required
          autoFocus
        />
        {formError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        {waiting ? (
          <p role="status" className="text-sm text-text-subtle">
            {tRoot('auth.rateLimitedFor', { seconds: formatNumber(waitCountdown.remaining) })}
          </p>
        ) : null}
        <Button type="submit" block loading={submitting} disabled={waiting}>
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
