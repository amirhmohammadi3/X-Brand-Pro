'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@/i18n/navigation';
import { resetPasswordBodySchema } from '@app/contracts';
import { qk } from '../../lib/api/qk';
import { isApiRequestError } from '../../lib/api/errors';
import { useForgotPassword, useResetPassword } from '../../lib/api/auth';
import { retryAfterSec } from './api-error';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useCountdown } from '../../lib/use-countdown';
import { createFormatters } from '../../lib/format';
import { useToast } from '../ui/toast';
import { RESET_IDENTIFIER_KEY } from './forgot-form';
import { AuthCard } from './auth-card';
import { IdentifierField } from './identifier-field';
import { Field, OtpInput, PasswordInput } from '../ui/form';
import { Button } from '../ui';

export interface ResetFormProps {
  /** Raw `?identifier=` value from the forgot screen (query wins). */
  initialIdentifier?: string;
}

/**
 * `ResetForm` (F1.8) — the `/reset-password` page body.
 *
 * The identifier comes prefilled from the query string, else sessionStorage
 * (written by the forgot screen); without either the user is sent back to
 * `/forgot-password` with a note instead of a broken form. The code is an
 * `OtpInput`; the new password uses the shared strength meter. Success shows
 * a toast and redirects to `/login` — the user then signs in with the new
 * password (deliberate: no auto-login after a reset).
 */
export function ResetForm({ initialIdentifier = '' }: ResetFormProps) {
  const t = useTranslations('auth.reset');
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { formatNumber } = createFormatters(locale);
  const reset = useResetPassword();
  const forgot = useForgotPassword();

  const [identifier, setIdentifier] = useState(initialIdentifier.trim());
  const [identifierMissing, setIdentifierMissing] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const waitCountdown = useCountdown();

  // No query value → restore from sessionStorage after mount (client-only
  // storage keeps the SSR output stable).
  useEffect(() => {
    if (identifier.length > 0) return;
    try {
      const stored = sessionStorage.getItem(RESET_IDENTIFIER_KEY);
      if (stored !== null && stored.length > 0) setIdentifier(stored);
      else setIdentifierMissing(true);
    } catch {
      setIdentifierMissing(true);
    }
    // Run once on mount only; identifier state may grow afterwards.
  }, []);

  const handleResend = async () => {
    setFormError(null);
    try {
      await forgot.mutateAsync({ identifier });
    } catch (err) {
      if (isApiRequestError(err) && err.code === 'RATE_LIMITED') {
        waitCountdown.start(retryAfterSec(err) ?? 60);
      }
      setFormError(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setCodeError(null);
    setPasswordError(null);

    const parsed = resetPasswordBodySchema.safeParse({ identifier, code, newPassword });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'code') setCodeError(tRoot('validation.required'));
        if (issue.path[0] === 'newPassword') setPasswordError(tRoot('validation.required'));
      }
      return;
    }
    setSubmitting(true);
    try {
      await reset.mutateAsync(parsed.data);
      try {
        sessionStorage.removeItem(RESET_IDENTIFIER_KEY);
      } catch {
        // ignore storage failures
      }
      queryClient.setQueryData(qk.auth.me(), null);
      toast.success(t('successToast'));
      router.replace('/login');
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      if (
        err.code === 'OTP_INVALID' ||
        err.code === 'OTP_EXPIRED' ||
        err.code === 'OTP_TOO_MANY_ATTEMPTS'
      ) {
        setCodeError(translateIssue(tRoot, { message: err.messageKey }));
        setCode('');
        return;
      }
      if (err.code === 'OTP_RESEND_TOO_SOON') {
        waitCountdown.start(retryAfterSec(err) ?? 60);
        setCodeError(translateIssue(tRoot, { message: err.messageKey }));
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    } finally {
      setSubmitting(false);
    }
  };

  if (identifierMissing) {
    return (
      <AuthCard title={t('title')}>
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-danger">
            {t('missingIdentifier')}
          </p>
          <Button variant="primary" asChild>
            <Link href="/forgot-password">{tRoot('auth.forgot.title')}</Link>
          </Button>
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
          autoComplete="username"
        />
        <div className="flex flex-col gap-1">
          <OtpInput
            length={6}
            value={code}
            onChange={setCode}
            name="reset-code"
            label={t('codeLabel')}
            error={codeError ?? undefined}
            disabled={submitting}
          />
        </div>
        <Field
          name="newPassword"
          label={t('newPasswordLabel')}
          error={passwordError ?? undefined}
          required
        >
          {(props) => (
            <PasswordInput
              {...props}
              showStrength
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        {formError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" block loading={submitting} disabled={waiting}>
          {t('submit')}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-text-subtle underline-offset-4 hover:text-text hover:underline disabled:opacity-50"
            onClick={() => void handleResend()}
            disabled={waiting || submitting}
          >
            {t('resend')}
          </button>
          {waiting ? (
            <span role="status" className="text-xs text-text-subtle">
              {tRoot('auth.rateLimitedFor', { seconds: formatNumber(waitCountdown.remaining) })}
            </span>
          ) : null}
        </div>
      </form>
    </AuthCard>
  );
}
