'use client';

/**
 * Service worker registration (F5.4). Runs once on mount in production only
 * (Next dev rewrites `/sw.js` per-request and the SW would intercept HMR
 * assets — registering in dev breaks the dev server, so we skip it). On
 * update, the SW calls `skipWaiting` so the new version takes over the next
 * navigation; we don't force a reload — the next route change picks up the
 * new SW cleanly.
 *
 * The hook returns the active registration or `null` so the install banner
 * and push-subscription hook can chain on it without re-registering.
 */
import { useEffect, useState } from 'react';

export type SwStatus =
  | { state: 'unsupported' }
  | { state: 'loading' }
  | { state: 'ready'; registration: ServiceWorkerRegistration }
  | { state: 'error'; error: string };

export function useServiceWorker(): SwStatus {
  const [status, setStatus] = useState<SwStatus>({ state: 'loading' });

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      setStatus({ state: 'unsupported' });
      return;
    }
    // Skip in Next.js dev: the dev server rewrites /sw.js per request and the
    // SW would intercept HMR chunks. The build/preview/prod path serves a
    // stable /sw.js, so registration is gated to non-dev.
    if (process.env.NODE_ENV !== 'production') {
      setStatus({ state: 'unsupported' });
      return;
    }
    let cancelled = false;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;
        setStatus({ state: 'ready', registration });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({
          state: 'error',
          error: err instanceof Error ? err.message : 'SW registration failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
