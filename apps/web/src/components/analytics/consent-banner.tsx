'use client';

/**
 * ConsentBanner (F7.7) — the privacy opt-in surface.
 *
 * Default-deny: no analytics beacon fires until the visitor clicks «اجازه».
 * The banner renders ONLY when consent is `'unknown'` (no choice made yet).
 * A `'denied'` choice hides the banner permanently (the visitor said no —
 * they should NOT be nagged); a `'granted'` choice hides it and the tracker
 * starts flushing its queue.
 *
 * The banner is `fixed` to the bottom on mobile and `sticky`-ish on desktop,
 * rendered ABOVE any toast/portals (z-index 50, below modal's 60). It carries
 * a short privacy summary + a link to the privacy page, and exactly two
 * buttons: «اجازه» (primary) and «رد» (ghost). There is no third state and
 * no "ask me later" — a deferred choice is a denied choice in privacy law.
 *
 * SSR-safe: the first paint is `null` (consent is `unknown` on the server);
 * after `useEffect` hydrates the store, the banner appears if no choice was
 * persisted. This avoids a hydration flash AND a flash of tracked content.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3 } from 'lucide-react';
import { Button } from '../ui/button';
import { Link } from '@/i18n/navigation';
import {
  denyConsent,
  grantConsent,
  hydrateConsent,
  subscribeToConsent,
  type AnalyticsConsent,
} from '../../lib/analytics';

export function ConsentBanner() {
  const t = useTranslations('analytics.consent');
  const [consent, setConsent] = useState<AnalyticsConsent>('unknown');

  // Hydrate on mount (reads localStorage client-side) + subscribe to flips.
  useEffect(() => {
    setConsent(hydrateConsent());
    return subscribeToConsent((next) => setConsent(next));
  }, []);

  // Only show when no choice has been made yet.
  if (consent !== 'unknown') return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('title')}
      data-testid="analytics-consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-subtle bg-surface px-4 py-3 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <BarChart3 className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{t('title')}</p>
          <p className="mt-0.5 text-xs text-text-subtle">
            {t('body')}{' '}
            <Link href="/p/privacy" className="text-primary hover:underline">
              {t('privacyLink')}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={denyConsent} data-testid="analytics-consent-deny">
            {t('deny')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={grantConsent}
            data-testid="analytics-consent-grant"
          >
            {t('grant')}
          </Button>
        </div>
      </div>
    </div>
  );
}
