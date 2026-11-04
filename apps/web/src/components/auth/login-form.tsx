'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@/i18n/navigation';
import { authResultSchema, loginBodySchema, type AuthResult } from '@app/contracts';
import { apiFetch } from '../../lib/api/client';
import { qk } from '../../lib/api/qk';
import { isApiRequestError } from '../../lib/api/errors';
import { safeNextPath } from '../../lib/auth/next-path';
import { useCountdown } from '../../lib/use-countdown';
import { createFormatters } from '../../lib/format';
import { Field, PasswordInput } from '../ui/form';
import { Button, Tabs } from '../ui';
import { AuthCard } from './auth-card';
import { IdentifierField } from './identifier-field';
import { OtpFlow } from './otp-flow';
import { GoogleButton } from './google-button';
import { useOAuthProviders, useRequestOtp, useVerifyOtp } from '../../lib/api/auth';
import { retryAfterSec } from './api-error';

export interface LoginFormProps {
  /** Raw `?next=` value — validated with `safeNextPath` before ANY use. */
  initialNext?: string;
}

/**
 * `LoginForm` (F1.8) — the `/login` page body.
 *
 *  - Tab 1 «ورود با رمز عبور»: identifier (username, email or phone) +
 *    password, a forgot-password link and inline mapping of the server error
 *    codes — INVALID_CREDENTIALS, ACCOUNT_BANNED, ACCOUNT_LOCKED (with a
 *    live countdown from `retryAfterSec`) and RATE_LIMITED (with its wait
 *    time).
 *  - Tab 2 «ورود با کد یکبار مصرف»: the shared `OtpFlow` (SMS / email).
 *  - Google button only when the public setting `oauth.google.enabled` is
 *    true.
 *
 * `next` is a site-relative path or `/` (open-redirect guard). After a
 * successful login the auth cache is seeded with the returned user and the
 * router REPLACES the target so Back leaves the app instead of returning to
 * the login form.
 */
export function LoginForm({ initialNext = '' }: LoginFormProps) {
  const t = useTranslations('auth.login');
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { formatNumber } = createFormatters(locale);
  const oauth = useOAuthProviders();

  const next = safeNextPath(initialNext);

  // --- shared wait state (lockout / rate limit) ------------------------------
  const [waitKind, setWaitKind] = useState<'locked' | 'rate-limited' | null>(null);
  const waitCountdown = useCountdown();
  const armWait = (kind: 'locked' | 'rate-limited', seconds: number | null) => {
    const s = seconds ?? 0;
    setWaitKind(s > 0 ? kind : null);
    if (s > 0) waitCountdown.start(s);
  };
  const waiting = waitKind !== null && waitCountdown.remaining > 0;
  const waitMessage = waiting
    ? waitKind === 'locked'
      ? tRoot('auth.lockedFor', { seconds: formatNumber(waitCountdown.remaining) })
      : tRoot('auth.rateLimitedFor', { seconds: formatNumber(waitCountdown.remaining) })
    : null;

  // --- password tab ----------------------------------------------------------
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (waiting || submitting) return;
    setFormError(null);
    setIdentifierError(null);
    setPasswordError(null);

    const parsed = loginBodySchema.safeParse({ identifier, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'identifier') setIdentifierError(tRoot('validation.required'));
        if (issue.path[0] === 'password') setPasswordError(tRoot('validation.required'));
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<AuthResult>('/auth/login', authResultSchema, {
        method: 'POST',
        body: parsed.data,
      });
      seedAuthCache(queryClient, result.data);
      router.replace(next);
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      if (err.code === 'ACCOUNT_LOCKED') {
        armWait('locked', retryAfterSec(err));
        return;
      }
      if (err.code === 'RATE_LIMITED') {
        armWait('rate-limited', retryAfterSec(err));
        return;
      }
      if (err.code === 'ACCOUNT_BANNED') {
        setFormError(t('banned'));
        return;
      }
      setFormError(tRoot(err.messageKey));
    } finally {
      setSubmitting(false);
    }
  };

  const passwordTab = (
    <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3" noValidate>
      <IdentifierField
        label={t('identifierLabel')}
        hint={t('identifierHint')}
        value={identifier}
        onChange={setIdentifier}
        error={identifierError ?? undefined}
        required
        autoComplete="username"
      />
      <Field name="password" label={t('passwordLabel')} error={passwordError ?? undefined} required>
        {(props) => (
          <PasswordInput
            {...props}
            showStrength={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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
      <div className="text-sm">
        <Link
          href="/forgot-password"
          className="text-text-subtle underline-offset-4 hover:text-text hover:underline"
        >
          {t('forgotLink')}
        </Link>
      </div>
    </form>
  );

  // --- OTP tab ---------------------------------------------------------------
  const [otpChannel, setOtpChannel] = useState<'sms' | 'email'>('sms');
  const [otpTarget, setOtpTarget] = useState('');
  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  const handleOtpVerify = async (code: string) => {
    const result = await verifyOtp.mutateAsync({
      channel: otpChannel,
      target: otpTarget.trim(),
      code,
    });
    seedAuthCache(queryClient, result);
    router.replace(next);
  };

  const otpTab = (
    <OtpFlow
      channel={otpChannel}
      onChannelChange={setOtpChannel}
      channelLabel={tRoot('auth.otp.channelLabel')}
      target={otpTarget}
      onTargetChange={setOtpTarget}
      onSend={() => requestOtp.mutateAsync({ channel: otpChannel, target: otpTarget.trim() })}
      onVerify={handleOtpVerify}
    />
  );

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <Tabs
        defaultValue="password"
        tabs={[
          { value: 'password', label: t('tabPassword'), content: passwordTab },
          { value: 'otp', label: t('tabOtp'), content: otpTab },
        ]}
      />
      {waitMessage !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-border bg-surface-alt p-3 text-sm text-danger"
        >
          {waitMessage}
        </p>
      ) : null}
      {oauth.googleEnabled ? (
        <div className="mt-5">
          <div className="relative my-4 text-center text-xs text-text-subtle">
            <span className="relative z-10 bg-surface px-2">{t('googleDivider')}</span>
            <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-border-subtle" />
          </div>
          <GoogleButton next={next} />
        </div>
      ) : null}
    </AuthCard>
  );
}

/** Seed the shared auth cache so every shell sees the new session. */
export function seedAuthCache(queryClient: QueryClient, result: AuthResult) {
  queryClient.setQueryData(qk.auth.me(), result.user);
}
