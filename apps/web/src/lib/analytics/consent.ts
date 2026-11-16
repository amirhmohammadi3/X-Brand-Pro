/**
 * Analytics consent state (F7.7) — the privacy gate in front of every beacon.
 *
 * Privacy contract (mirrors `@app/contracts` analytics): the tracker sends NO
 * identity — only `{ businessId, type, occurredAt? }`. Dedup is the API's job
 * on a salted ip hash held in Redis for an hour, never persisted. Even so, the
 * client is default-deny: no event fires until the visitor explicitly opts in.
 * A denied/unknown consent short-circuits `track()` before any network IO.
 *
 * Persistence is `localStorage` (a single string under `XBRAND_ANALYTICS_CONSENT`).
 * The value is one of `'granted' | 'denied' | 'unknown'`:
 *   - `unknown` (no key, or a corrupt value) — the banner shows, nothing fires.
 *   - `denied` — the banner stays hidden, nothing fires (the visitor said no).
 *   - `granted` — the banner stays hidden, the tracker batches + flushes.
 *
 * The store is a tiny pub/sub so a `<ConsentBanner/>` flip propagates to the
 * already-mounted tracker without a re-mount. SSR-safe: every `localStorage`
 * access is guarded by `typeof window !== 'undefined'`; the initial server
 * render is always `'unknown'` (the banner hydrates client-side).
 */
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from '@app/contracts';

/** The three states a visitor can be in w.r.t. analytics. */
export type AnalyticsConsent = 'granted' | 'denied' | 'unknown';

export const CONSENT_STORAGE_KEY = 'XBRAND_ANALYTICS_CONSENT';
/** The event-type set the tracker accepts (defensive — mirrors the contract). */
export const TRACKABLE_EVENT_TYPES: ReadonlySet<AnalyticsEventType> = new Set(ANALYTICS_EVENT_TYPES);

type Listener = (next: AnalyticsConsent) => void;

const listeners = new Set<Listener>();
/** The live consent value. `unknown` until the client hydrates and reads LS. */
let current: AnalyticsConsent = 'unknown';
let hydrated = false;

function readStorage(): AnalyticsConsent {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return 'unknown';
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
    if (raw === null) return 'unknown';
    // Corrupt / foreign value — treat as unknown and clear it so the banner re-shows.
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    return 'unknown';
  } catch {
    // localStorage can throw in private mode / sandboxed iframes — fail closed.
    return 'unknown';
  }
}

function writeStorage(next: AnalyticsConsent): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    if (next === 'unknown') window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    else window.localStorage.setItem(CONSENT_STORAGE_KEY, next);
  } catch {
    // Ignore — the in-memory state still flips; persistence is best-effort.
  }
}

/** Pull the persisted value into the in-memory store. Idempotent. */
export function hydrateConsent(): AnalyticsConsent {
  if (hydrated) return current;
  hydrated = true;
  const next = readStorage();
  if (next !== current) {
    current = next;
    emit(next);
  }
  return current;
}

/** The current consent value (sync, SSR-safe — `unknown` on the server). */
export function getConsent(): AnalyticsConsent {
  return current;
}

/** Whether beacons may fire at this moment (consent is `granted` AND we're on the client). */
export function consentAllowsTracking(): boolean {
  return current === 'granted' && typeof navigator !== 'undefined';
}

function emit(next: AnalyticsConsent): void {
  for (const l of listeners) {
    try {
      l(next);
    } catch {
      // A listener throwing must never break the store.
    }
  }
}

function set(next: AnalyticsConsent): void {
  if (next === current) return;
  current = next;
  writeStorage(next);
  emit(next);
}

/** The visitor opted in. Persists + notifies; the tracker starts flushing. */
export function grantConsent(): void {
  hydrated = true;
  set('granted');
}

/** The visitor opted out. Persists + notifies; the tracker drops its queue. */
export function denyConsent(): void {
  hydrated = true;
  set('denied');
}

/** Forget the choice (used by the privacy panel's «reset» if ever added). */
export function resetConsent(): void {
  set('unknown');
}

/** Subscribe to consent changes. Returns an unsubscribe function. */
export function subscribeToConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
