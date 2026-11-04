'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { CurrentUser, OtpChannel } from '@app/contracts';
import { qk } from '../../lib/api/qk';
import { useVerifyConfirm, useVerifyRequest } from '../../lib/api/auth';
import { AuthCard } from './auth-card';
import { OtpFlow } from './otp-flow';
import { Button, Text } from '../ui';

export interface VerifyClientProps {
  /** Server-resolved, authenticated user (the page is behind requireUser). */
  user: CurrentUser;
}

/**
 * `VerifyClient` (F1.8) — the `/verify` page body, reached from the account
 * area. Channel choice (SMS / email) with the stored identifier prefilled
 * (editable, the API accepts a new/pending target too); a channel whose
 * identifier is absent from the account is disabled with a hint. A
 * successful confirm invalidates the auth cache so every shell immediately
 * sees `emailVerified`/`phoneVerified` flip.
 */
export function VerifyClient({ user }: VerifyClientProps) {
  const t = useTranslations('auth.verify');
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const requestVerification = useVerifyRequest();
  const confirmVerification = useVerifyConfirm();

  const hasPhone = typeof user.phone === 'string' && user.phone.length > 0;
  const hasEmail = typeof user.email === 'string' && user.email.length > 0;

  const [channel, setChannel] = useState<OtpChannel>(hasPhone ? 'sms' : 'email');
  const [target, setTarget] = useState(hasPhone ? (user.phone ?? '') : (user.email ?? ''));
  const [done, setDone] = useState(false);

  const handleChannelChange = (next: OtpChannel) => {
    setChannel(next);
    // Prefill the stored identifier of the newly selected channel.
    setTarget(next === 'sms' ? (user.phone ?? '') : (user.email ?? ''));
  };

  const handleVerify = async (code: string) => {
    await confirmVerification.mutateAsync({ channel, target: target.trim(), code });
    await queryClient.invalidateQueries({ queryKey: qk.auth.me() });
    setDone(true);
  };

  if (done) {
    return (
      <AuthCard title={t('successTitle')}>
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 size={32} className="text-success" aria-hidden="true" />
          <Text as="p" size="sm" muted>
            {t('successDescription')}
          </Text>
          <Button variant="secondary" asChild>
            <Link href="/">{t('backToHome')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <OtpFlow
        channel={channel}
        onChannelChange={handleChannelChange}
        channelLabel={tRoot('auth.otp.channelLabel')}
        target={target}
        onTargetChange={setTarget}
        onSend={() => requestVerification.mutateAsync({ channel, target: target.trim() })}
        onVerify={handleVerify}
      />
      {!hasEmail ? <p className="mt-3 text-xs text-text-subtle">{t('noEmailStored')}</p> : null}
      {!hasPhone ? <p className="mt-3 text-xs text-text-subtle">{t('noPhoneStored')}</p> : null}
    </AuthCard>
  );
}
