'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  emailSchema,
  iranMobileSchema,
  otpRequestResultSchema,
  type OtpChannel,
  type OtpRequestResult,
} from '@app/contracts';
import { isApiRequestError } from '../../lib/api/errors';
import { useCountdown } from '../../lib/use-countdown';
import { createFormatters } from '../../lib/format';
import { translateIssue } from '../../lib/forms/translate-issue';
import { Button } from '../ui';
import { Field, Input, OtpInput, PhoneInput } from '../ui/form';
import { SegmentedControl } from './segmented-control';
import { retryAfterSec } from './api-error';

export interface OtpFlowProps {
  /** Delivery channel (parent-owned so the page can read it). */
  channel: OtpChannel;
  /** Omitted when the caller fixes the channel. */
  onChannelChange?: (channel: OtpChannel) => void;
  /** Accessible name for the channel selector. */
  channelLabel: string;
  /** Channel target — E.164 phone for sms, email address for email. */
  target: string;
  onTargetChange: (value: string) => void;
  /** Issue a code. Resolve → the flow switches to the code step. */
  onSend: () => Promise<OtpRequestResult>;
  /** Confirm a code. Reject → the error is shown and cells clear. */
  onVerify: (code: string) => Promise<void>;
  /** Disable everything (e.g. while the account is locked). */
  disabled?: boolean;
  /** OTP cell count (API default is 6). */
  codeLength?: number;
  className?: string;
}

type Step = 'target' | 'code';

/**
 * `OtpFlow` (F1.8) — the send-code → enter-code flow shared by the login
 * OTP tab and the account `/verify` page:
 *
 *  - channel via a segmented control (SMS / email) when `onChannelChange`
 *    is given; the target input follows the channel (PhoneInput / email);
 *  - the target is validated locally with the CONTRACT primitives before
 *    `onSend` fires (wrong channel/target never reaches the API);
 *  - after a successful send the flow shows the `OtpInput`, the masked
 *    target, a resend button armed with the API's `resendAfterSec` (shown
 *    as a live countdown with locale digits) and an edit affordance;
 *  - the code auto-submits when the last cell is filled;
 *  - wrong/expired codes (`OTP_*`), throttled sends (`OTP_RESEND_TOO_SOON`
 *    with its `retryAfterSec`) and network failures surface through the
 *    standard `errors.*` keys.
 */
export function OtpFlow({
  channel,
  onChannelChange,
  channelLabel,
  target,
  onTargetChange,
  onSend,
  onVerify,
  disabled = false,
  codeLength = 6,
  className,
}: OtpFlowProps) {
  const t = useTranslations('auth.otp');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);

  const [step, setStep] = useState<Step>('target');
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const resend = useCountdown();

  // A channel switch invalidates any code issued for the old channel. Reset
  // in the handler (not an effect) so the reset is tied to the user action.
  const handleChannelChange = (next: OtpChannel) => {
    setStep('target');
    setMaskedTarget(null);
    setSendError(null);
    setCodeError(null);
    setCode('');
    resend.reset();
    onChannelChange?.(next);
  };

  const validateTarget = (): string | null => {
    const value = target.trim();
    if (channel === 'sms') {
      return iranMobileSchema.safeParse(value).success ? null : t('invalidTargetPhone');
    }
    return emailSchema.safeParse(value).success ? null : t('invalidTargetEmail');
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    setSendError(null);
    setCodeError(null);
    const invalid = validateTarget();
    if (invalid !== null) {
      setSendError(invalid);
      return;
    }
    setSending(true);
    try {
      const result = otpRequestResultSchema.parse(await onSend());
      setMaskedTarget(result.targetMasked);
      resend.start(result.resendAfterSec);
      setStep('code');
    } catch (err) {
      if (isApiRequestError(err) && err.code === 'OTP_RESEND_TOO_SOON') {
        resend.start(retryAfterSec(err) ?? 60);
        setSendError(translateIssue(tRoot, { message: err.messageKey }));
      } else {
        setSendError(
          isApiRequestError(err)
            ? translateIssue(tRoot, { message: err.messageKey })
            : tRoot('errors.internal_error'),
        );
      }
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (submitted: string) => {
    setCodeError(null);
    setVerifying(true);
    try {
      await onVerify(submitted);
      // Success: the page navigates or swaps content — keep the busy state.
    } catch (err) {
      setVerifying(false);
      setCode(''); // let the user retype the code from scratch
      setCodeError(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  };

  const busy = disabled || sending;

  return (
    <div className={className}>
      {onChannelChange !== undefined ? (
        <SegmentedControl
          label={channelLabel}
          value={channel}
          onValueChange={handleChannelChange}
          options={[
            { value: 'sms' as OtpChannel, label: t('channelSms') },
            { value: 'email' as OtpChannel, label: t('channelEmail') },
          ]}
          className="mb-3"
        />
      ) : null}

      {step === 'target' ? (
        <form onSubmit={handleSend} className="flex flex-col gap-3" noValidate>
          {channel === 'sms' ? (
            <Field name="otp-target" label={t('targetPhoneLabel')} error={sendError ?? undefined}>
              {(props) => (
                <PhoneInput
                  {...props}
                  value={target}
                  onValueChange={onTargetChange}
                  disabled={busy}
                />
              )}
            </Field>
          ) : (
            <Field name="otp-target" label={t('targetEmailLabel')} error={sendError ?? undefined}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  dir="ltr"
                  className="text-start"
                  value={target}
                  onChange={(e) => onTargetChange(e.target.value)}
                  autoComplete="email"
                  disabled={busy}
                />
              )}
            </Field>
          )}
          <Button type="submit" block loading={sending} disabled={busy}>
            {t('send')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {maskedTarget ? (
            <p className="text-sm text-text-subtle">
              {t('sentTo')} <bdi className="font-medium text-text">{maskedTarget}</bdi>
            </p>
          ) : null}
          <OtpInput
            length={codeLength}
            value={code}
            onChange={setCode}
            onComplete={handleVerify}
            name="otp-code"
            label={t('codeLabel')}
            error={codeError ?? undefined}
            disabled={disabled || verifying}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2 text-sm">
            {resend.remaining > 0 ? (
              <span className="text-text-subtle">
                {t('resendIn', { seconds: formatNumber(resend.remaining) })}
              </span>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void handleSend()}
                disabled={disabled || sending}
              >
                {t('resend')}
              </Button>
            )}
            <button
              type="button"
              className="text-text-subtle underline-offset-4 hover:text-text hover:underline"
              onClick={() => setStep('target')}
              disabled={disabled}
            >
              {t('editTarget')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
