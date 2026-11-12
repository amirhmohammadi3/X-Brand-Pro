'use client';

/**
 * Push devices tab (F5.4) — the third tab of the notification center.
 *
 * Renders:
 *  - a one-shot "enable push on this device" CTA when the platform supports
 *    it and the visitor has NOT yet subscribed here. The CTA chains
 *    permission request → `pushManager.subscribe` → POST
 *    `/notifications/me/push/subscriptions` and surfaces the outcome as a
 *    toast (the hook returns a stable error code so the message is i18n-keyed,
 *    never raw);
 *  - the list of the caller's saved subscriptions (`GET
 *    /notifications/me/push/subscriptions`) with a per-row DELETE.
 *
 * The SW registration is fetched lazily via `useServiceWorker` — in
 * production the SW is registered by `<PwaBootstrap />` at layout mount, so
 * by the time the visitor opens this tab the registration is usually `ready`.
 * In dev the SW is intentionally not registered; the CTA renders an
 * "unsupported" note instead of crashing.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BellRing, Smartphone, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Spinner, useToast } from '../ui';
import { useServiceWorker } from '../../lib/pwa/use-service-worker';
import { usePushDevices, usePushSubscription } from '../../lib/pwa/use-push-subscription';
import type { PushSubscribeOutcome } from '../../lib/pwa/use-push-subscription';

export function PushDevicesTab() {
  const t = useTranslations('account.notifications.devices');
  const tRoot = useTranslations();
  const toast = useToast();
  const sw = useServiceWorker();
  const registration = sw.state === 'ready' ? sw.registration : null;
  const { result, isPending, error } = usePushDevices(true);
  const { subscribe, remove } = usePushSubscription(registration);
  const [subscribing, setSubscribing] = useState(false);

  const handleSubscribe = async (): Promise<void> => {
    setSubscribing(true);
    try {
      const outcome: PushSubscribeOutcome = await subscribe();
      if (outcome.ok) {
        toast.success(t('subscribedToast'));
      } else {
        toast.error(mapPushError(outcome.error, t));
      }
    } finally {
      setSubscribing(false);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    const res = await remove(id);
    if (res?.deleted) {
      toast.success(t('removedToast'));
    } else {
      toast.error(t('removeError'));
    }
  };

  if (sw.state === 'error') {
    return <ErrorState error={t('swError')} />;
  }

  const unsupported =
    sw.state === 'unsupported' ||
    (sw.state === 'ready' && typeof window !== 'undefined' && !('PushManager' in window));

  return (
    <div className="flex flex-col gap-4" data-testid="push-devices">
      <div className="rounded-md border border-border-subtle bg-surface p-4">
        <div className="flex items-start gap-3">
          <BellRing className="mt-1 shrink-0 text-primary" size={20} aria-hidden />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-text">{t('enableTitle')}</p>
            <p className="text-sm text-muted">{t('enableBody')}</p>
            {unsupported ? (
              <Badge variant="neutral">{t('unsupported')}</Badge>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={subscribing}
                onClick={handleSubscribe}
                data-testid="push-enable"
              >
                {t('enableAction')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState error={t('loadError')} />
      ) : isPending && !result ? (
        <Spinner aria-label={tRoot('common.loading')} />
      ) : (result?.items ?? []).length === 0 ? (
        <EmptyState icon={Smartphone} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle" data-testid="push-devices-list">
          {(result?.items ?? []).map((device) => (
            <li
              key={device.id}
              className="flex items-center gap-3 py-3"
              data-testid="push-device-row"
            >
              <Smartphone className="shrink-0 text-muted" size={18} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">
                  {device.userAgent || t('unknownDevice')}
                </p>
                <p className="truncate text-xs text-muted" dir="ltr">
                  {device.endpoint}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('removeAria')}
                onClick={() => void handleRemove(device.id)}
                data-testid="push-device-remove"
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Map the hook's stable error code to a localized message for the toast. */
export function mapPushError(
  code: 'unsupported' | 'no_vapid' | 'denied' | 'network' | 'unknown',
  t: ReturnType<typeof useTranslations>,
): string {
  switch (code) {
    case 'unsupported':
      return t('errorUnsupported');
    case 'no_vapid':
      return t('errorNoVapid');
    case 'denied':
      return t('errorDenied');
    case 'network':
      return t('errorNetwork');
    default:
      return t('errorUnknown');
  }
}
