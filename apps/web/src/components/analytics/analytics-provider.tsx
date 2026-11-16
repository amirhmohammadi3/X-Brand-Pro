'use client';

/**
 * AnalyticsProvider (F7.7) — the single mount point for the analytics client.
 *
 * Mounted once at the locale root layout. It:
 *   1. Binds the tracker's consent listener (so a `deny` flip drops the
 *      buffered queue). Cleanup on unmount.
 *   2. Renders `<ConsentBanner/>` (which self-hides once a choice is made).
 *
 * It does NOT hydrate the consent store itself — `<ConsentBanner/>` does that
 * in its own effect (so a server-only render, where the provider is mounted
 * but the banner is not, never reads localStorage on the server).
 *
 * The provider is a client component (it uses `useEffect`), but it renders
 * its children untouched so the server-rendered tree below it is unaffected.
 */
import { useEffect } from 'react';
import { bindConsentListener } from '../../lib/analytics';
import { ConsentBanner } from './consent-banner';

export function AnalyticsProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    // Wire the consent store → tracker: a flip to denied/unknown drops the
    // in-flight queue. Returns the unsubscribe for cleanup.
    return bindConsentListener();
  }, []);

  return (
    <>
      {children}
      <ConsentBanner />
    </>
  );
}
