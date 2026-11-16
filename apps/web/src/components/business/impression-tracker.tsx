'use client';

/**
 * ImpressionTracker (F7.7) — fires ONE `impression` event when this island
 * scrolls into view. Designed to wrap a server-rendered card (e.g.
 * `BusinessCard`) without forcing the card itself to become a client
 * component: the tracker renders a `span` sentinel and observes IT (not the
 * card), so the card's markup stays server-rendered.
 *
 * One event per business per session (the `SESSION_IMPRESSIONED` set inside
 * `useTrackImpression` guards a re-mount + a scroll-away-and-back). No-op
 * until consent is `granted`; no-op in SSR (the observer attaches in the
 * effect, which is client-only).
 *
 * Usage:
 *   <ImpressionTracker businessId={hit.id}>
 *     <BusinessCard hit={hit} locale={locale} />
 *   </ImpressionTracker>
 */
import { useRef, type ReactNode } from 'react';
import { useTrackImpression } from '../../lib/analytics';

export function ImpressionTracker({
  businessId,
  children,
}: {
  businessId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useTrackImpression(businessId, ref);
  // A zero-size inline sentinel: it does not affect layout, but its position
  // in the document flow (top of the card) is what the observer measures.
  return (
    <>
      <span ref={ref} aria-hidden className="sr-only -order-first" />
      {children}
    </>
  );
}
