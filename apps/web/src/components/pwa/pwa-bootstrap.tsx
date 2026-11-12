'use client';

/**
 * PWA bootstrap (F5.4) — mounted once in the locale layout's `<body>`. It:
 *   1. Registers `/sw.js` (production only — see `useServiceWorker` for why
 *      dev is skipped).
 *   2. Surfaces the install banner when the platform signals installability
 *      (`beforeinstallprompt`) or shows iOS Safari share-sheet guidance.
 *
 * The bootstrap does NOT auto-subscribe to push — push subscription is a
 * user-gesture-gated action surfaced in the notification preferences view,
 * not a blanket opt-in on every page load (the platform requires permission
 * anyway, and asking on first paint is a known engagement killer).
 */
import { useServiceWorker } from '../../lib/pwa/use-service-worker';
import { InstallBanner } from './install-banner';

export function PwaBootstrap() {
  useServiceWorker();
  return <InstallBanner />;
}
