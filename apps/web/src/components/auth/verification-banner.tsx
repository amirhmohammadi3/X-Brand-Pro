'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MailWarning, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { IconButton } from '../ui/icon-button';

/**
 * `VerificationBanner` (F1.8). Shown in the `(account)` layout while BOTH
 * the email and the phone are unverified (including "no contact info yet" —
 * the nudge links to `/verify` where an identifier can be added and
 * verified). Dismissible for the session; reappears on the next visit
 * because it reflects server state, not a stored preference.
 */
export function VerificationBanner({ className }: { className?: string }) {
  const { user } = useAuth();
  const t = useTranslations('auth.banner');
  const [dismissed, setDismissed] = useState(false);

  if (!user || dismissed) return null;
  if (user.emailVerified || user.phoneVerified) return null;

  return (
    <section
      aria-label={t('title')}
      className={
        'mb-4 flex items-start gap-3 rounded-md border border-border bg-surface-alt p-3 ' +
        (className ?? '')
      }
    >
      <MailWarning size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{t('title')}</p>
        <p className="mt-0.5 text-xs text-text-subtle">{t('description')}</p>
      </div>
      <Link
        href="/verify"
        className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t('action')}
      </Link>
      <IconButton
        icon={X}
        size="sm"
        variant="ghost"
        aria-label={t('dismiss')}
        onClick={() => setDismissed(true)}
        className="shrink-0 text-text-subtle hover:text-text"
      />
    </section>
  );
}
