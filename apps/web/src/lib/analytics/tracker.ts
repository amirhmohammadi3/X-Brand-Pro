/**
 * Analytics tracker (F7.7) — the privacy-first beacon sender.
 *
 * POSTs `{ events: [{ businessId, type, occurredAt? }] }` to the B7.1 public
 * endpoint `/analytics/events`. The contract caps a batch at
 * `ANALYTICS_BATCH_MAX` (25) events; the tracker buffers up to that many, then
 * flushes on a debounce OR when the batch is full OR on `visibilitychange`→
 * hidden (page-unload beacon). It NEVER throws: the endpoint is anonymous +
 * fail-soft (returns `{ accepted }` even on Redis outage), so a network error
 * is swallowed and the events are dropped — the page must never break on
 * analytics.
 *
 * Privacy gate: `consentAllowsTracking()` is checked on every `track()` AND on
 * every flush. A flip to `denied`/`unknown` mid-session stops new events AND
 * drops the buffered queue (a granted→denied transition must not leak the
 * already-buffered events the visitor then withdrew consent for).
 *
 * Transport: `navigator.sendBeacon` is the fire-and-forget POST the unload
 * path needs (it survives the page teardown); `fetch(..., { keepalive: true })`
 * is the fallback when `sendBeacon` is absent (older Safari / some webviews).
 * Both send a `Content-Type: application/json` body. The response is ignored —
 * the tracker is not a TanStack Query, it does not retry, it does not surface
 * errors. `accepted` is best-effort and the API's dedup already happened.
 */
import {
  ANALYTICS_BATCH_MAX,
  type AnalyticsEventInput,
  type AnalyticsEventType,
} from '@app/contracts';
import {
  consentAllowsTracking,
  denyConsent,
  subscribeToConsent,
  TRACKABLE_EVENT_TYPES,
} from './consent';

/** The queue shape (the raw event input + a client timestamp for ordering). */
interface QueuedEvent {
  businessId: string;
  type: AnalyticsEventType;
  occurredAt?: string;
}

/** The POST body — the contract's `IngestAnalyticsBody`. */
interface IngestBody {
  events: AnalyticsEventInput[];
}

const FLUSH_DEBOUNCE_MS = 1500;
const ENDPOINT_PATH = '/analytics/events';

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unloadListenerBound = false;

function apiUrl(): string {
  // `NEXT_PUBLIC_API_URL` already includes `/api/v1` (see env.ts default).
  const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  return `${base}${ENDPOINT_PATH}`;
}

function isUuid(value: string): boolean {
  // The contract's uuidSchema is the source of truth; the client only guards
  // against an obviously-bad id so a programming error doesn't enqueue junk.
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

/** Schedule a debounced flush (cleared + reset on every new event). */
function scheduleFlush(): void {
  if (typeof window === 'undefined') return;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

/** Drain the queue into one POST. Fail-soft: any error drops the batch. */
export async function flush(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  if (queue.length === 0) return;
  // Re-check consent at flush time — a flip between enqueue + flush matters.
  if (!consentAllowsTracking()) {
    queue = [];
    return;
  }
  const batch = queue.slice(0, ANALYTICS_BATCH_MAX);
  queue = queue.slice(batch.length);
  const body = JSON.stringify({ events: batch } satisfies IngestBody);
  try {
    // Prefer sendBeacon (survives page teardown); fall back to keepalive fetch.
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      // sendBeacon returns false when the browser caps the payload (64KB),
      // a same-origin/CORS block, or the page is mid-teardown — fall through.
      const ok = navigator.sendBeacon(apiUrl(), blob);
      if (ok) return;
    }
    await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    });
  } catch {
    // Network/CORS/abort — drop the batch. The API is anonymous + fail-soft;
    // a dropped event is acceptable (the dedup would have eaten a duplicate
    // business_view anyway). Never throw to the caller.
  }
}

function bindUnloadListener(): void {
  if (unloadListenerBound || typeof window === 'undefined') return;
  unloadListenerBound = true;
  // `pagehide` covers bfcache + mobile tab close; `visibilitychange`→hidden
  // covers desktop tab-switch. Both fire a final flush attempt.
  window.addEventListener('pagehide', () => {
    if (queue.length > 0) void flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && queue.length > 0) void flush();
  });
}

/**
 * Enqueue one event. Validates the type (against the contract set) and the
 * businessId (UUID shape) BEFORE touching the queue, so a programming error
 * (a stray `track('foo', id)`) is silently dropped, never thrown.
 *
 * Returns `true` if the event was queued, `false` if it was dropped (consent
 * not granted, bad type/id, or the buffer is full and the flush hasn't run).
 */
export function track(type: AnalyticsEventType, businessId: string): boolean {
  if (!TRACKABLE_EVENT_TYPES.has(type)) return false;
  if (!isUuid(businessId)) return false;
  if (!consentAllowsTracking()) return false;
  if (queue.length >= ANALYTICS_BATCH_MAX) {
    // Buffer full — flush now (out of band) so the new event isn't lost. The
    // debounce timer stays; a flush() in flight doesn't double-fire.
    void flush();
  }
  queue.push({ businessId, type });
  bindUnloadListener();
  scheduleFlush();
  return true;
}

/** Convenience wrappers — the named call-sites (call sites stay readable). */
export function trackBusinessView(businessId: string): boolean {
  return track('business_view', businessId);
}
export function trackImpression(businessId: string): boolean {
  return track('impression', businessId);
}
export function trackCallClick(businessId: string): boolean {
  return track('call_click', businessId);
}
export function trackDirectionClick(businessId: string): boolean {
  return track('direction_click', businessId);
}
export function trackShareClick(businessId: string): boolean {
  return track('share_click', businessId);
}

/**
 * Wire the consent store's deny transition: when consent flips to `denied` OR
 * back to `unknown`, the buffered queue is dropped (the visitor withdrew
 * permission — those events must NOT ship). Called once by `<AnalyticsProvider>`.
 */
export function bindConsentListener(): () => void {
  return subscribeToConsent((next) => {
    if (next !== 'granted') {
      queue = [];
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    }
  });
}

/**
 * Test-only helpers. Reset the module state between specs so the queue + timer
 * don't leak across the suite. NOT exported from the barrel (no app code uses
 * these — they're imported directly from the module path in tests).
 */
export function __resetForTests(): void {
  queue = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** Test-only: the current queue snapshot (for asserting batch composition). */
export function __queueSnapshot(): readonly QueuedEvent[] {
  return queue;
}

// Re-export the consent setter the banner needs, so app code imports from one
// place. (denyConsent is the explicit opt-out; grantConsent lives in consent.ts
// but is re-exported here for symmetry with the tracker module surface.)
export { denyConsent };
