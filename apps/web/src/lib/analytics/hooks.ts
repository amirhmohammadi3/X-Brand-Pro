'use client';

/**
 * Analytics hooks (F7.7) — the React surface over the tracker.
 *
 * - `useTrackBusinessView(businessId)` — fires ONE `business_view` per mount
 *   (the B7.1 dedup would eat a duplicate within the hour anyway, but the
 *   client also guards a re-mount of the same business during a session with
 *   a `Set` so a React 18 strict-mode double-invoke or a back-button revisit
 *   doesn't enqueue a second event). SSR-safe: the effect runs client-only.
 *
 * - `useTrackImpression(businessId, ref)` — fires ONE `impression` when the
 *   ref enters the viewport (IntersectionObserver, rootMargin so a card
 *   scrolling past the fold counts). Fires once per businessId per session
 *   (same strict-mode/revisit guard as the view hook). No-op when consent is
 *   not granted, when IntersectionObserver is absent, or in SSR.
 *
 * Both hooks are no-ops when consent is not `granted` — `track()` re-checks
 * `consentAllowsTracking()` on every call, so a not-yet-opted-in visitor
 * enqueues nothing. After opt-in, the hooks do not retroactively fire for
 * businesses already visited (a privacy choice — the visitor didn't consent
 * at the time, so that view is gone, not back-filled).
 */
import { useEffect, useRef } from 'react';
import { trackBusinessView, trackImpression } from './tracker';

const SESSION_VIEWED = new Set<string>();
const SESSION_IMPRESSIONED = new Set<string>();

/**
 * Fire one `business_view` per business per session on mount. Safe under
 * React strict-mode's double-invoke (the `SESSION_VIEWED` set guards it) and
 * under client-side navigation back to the same page.
 */
export function useTrackBusinessView(businessId: string | null | undefined): void {
  useEffect(() => {
    if (!businessId) return;
    if (SESSION_VIEWED.has(businessId)) return;
    SESSION_VIEWED.add(businessId);
    trackBusinessView(businessId);
  }, [businessId]);
}

/**
 * Fire one `impression` when the ref's element enters the viewport. Pass a
 * ref created with `useRef<HTMLElement | null>(null)`; the hook attaches the
 * observer on mount and detaches on unmount.
 */
export function useTrackImpression(
  businessId: string | null | undefined,
  ref: React.RefObject<HTMLElement | null>,
): void {
  const observed = useRef(false);

  useEffect(() => {
    if (!businessId) return;
    if (SESSION_IMPRESSIONED.has(businessId)) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR / very old browser — fall back to a view-equivalent (count it).
      SESSION_IMPRESSIONED.add(businessId);
      trackImpression(businessId);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !observed.current) {
            observed.current = true;
            SESSION_IMPRESSIONED.add(businessId);
            trackImpression(businessId);
            observer.disconnect();
            break;
          }
        }
      },
      // A card scrolled at least 50% into view counts as a real impression.
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [businessId, ref]);
}
