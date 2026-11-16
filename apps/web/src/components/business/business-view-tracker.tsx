'use client';

/**
 * BusinessViewTracker (F7.7) — fires ONE `business_view` event per business per
 * session when the public business page mounts.
 *
 * A tiny client island at the top of the server-rendered business page. The
 * `useTrackBusinessView` hook is a no-op until consent is `granted` (the
 * tracker re-checks `consentAllowsTracking()` on every call), so a fresh
 * visitor who hasn't opted in enqueues nothing — and the view is NOT
 * back-filled after opt-in (a privacy choice: the visitor didn't consent at
 * the time, so that view is gone).
 *
 * Renders nothing — it is a side-effect-only component.
 */
import { useTrackBusinessView } from '../../lib/analytics';

export function BusinessViewTracker({ businessId }: { businessId: string }) {
  useTrackBusinessView(businessId);
  return null;
}
