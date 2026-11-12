'use client';

/**
 * Install banner (F5.4). Renders when the platform fires
 * `beforeinstallprompt` (Chrome/Edge) OR when the visitor is on iOS Safari
 * and not yet in standalone mode — iOS does not fire the event, so the banner
 * shows the «Add to Home Screen» share-sheet steps instead.
 *
 * The banner is dismissible for the session (state is in-memory; a persisted
 * dismissal would gate the surface behind a settings toggle, which F5.4 keeps
 * in the notification preferences, not here). On a successful install the
 * `appinstalled` event flips `isStandalone` and the banner unmounts.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInstallPrompt } from '../../lib/pwa/use-install-prompt';
import { Button } from '../ui/button';

export function InstallBanner() {
  const t = useTranslations('pwa.install');
  const install = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || install.isStandalone) return null;

  // iOS Safari path: no programmatic prompt — render share-sheet guidance.
  if (install.isIos) {
    return (
      <div
        role="region"
        aria-label={t('title')}
        className="m-4 rounded-md border border-border-subtle bg-surface px-4 py-3 text-sm"
      >
        <p className="font-medium text-text">{t('iosTitle')}</p>
        <p className="mt-1 text-text-subtle">{t('iosBody')}</p>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    );
  }

  if (!install.canPrompt) return null;

  return (
    <div
      role="region"
      aria-label={t('title')}
      className="m-4 rounded-md border border-border-subtle bg-surface px-4 py-3 text-sm"
    >
      <p className="font-medium text-text">{t('title')}</p>
      <p className="mt-1 text-text-subtle">{t('body')}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          {t('dismiss')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void install.prompt();
          }}
        >
          {t('action')}
        </Button>
      </div>
    </div>
  );
}
