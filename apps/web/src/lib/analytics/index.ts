/**
 * Analytics client barrel (F7.7) — the public surface app code imports from.
 *
 *   import { useTrackBusinessView, useTrackImpression, trackCallClick,
 *            grantConsent, denyConsent, getConsent } from '@/lib/analytics';
 *
 * Privacy-first: every export here checks `consentAllowsTracking()` before any
 * network IO, and the consent store is default-deny (no beacon fires until the
 * visitor opts in via `<ConsentBanner/>`).
 */
export {
  getConsent,
  grantConsent,
  denyConsent,
  resetConsent,
  hydrateConsent,
  subscribeToConsent,
  consentAllowsTracking,
  type AnalyticsConsent,
} from './consent';
export {
  track,
  trackBusinessView,
  trackImpression,
  trackCallClick,
  trackDirectionClick,
  trackShareClick,
  flush,
  bindConsentListener,
} from './tracker';
export { useTrackBusinessView, useTrackImpression } from './hooks';
