// @vitest-environment jsdom
/**
 * F7.7 analytics tracker + consent store — pure logic, no React.
 *
 * Covers the privacy contract end-to-end:
 *  - default-deny: a fresh visitor (no consent) enqueues NOTHING;
 *  - consent gate: `track()` is a no-op until `grantConsent()` is called;
 *  - consent withdrawal: a flip to `denyConsent()` drops the buffered queue +
 *    cancels the pending flush timer;
 *  - batching: events queue up to ANALYTICS_BATCH_MAX, then a flush fires;
 *  - fail-soft: a network error / a missing `sendBeacon` never throws — the
 *    batch is dropped silently (the page must never break on analytics);
 *  - transport: `navigator.sendBeacon` is preferred; `fetch(keepalive)` is
 *    the fallback when sendBeacon is absent or returns false.
 *  - validation: a bad event type or a non-UUID businessId is silently
 *    dropped (the contract's job is server-side, but the client guards too).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ANALYTICS_BATCH_MAX = 25;

// Each test resets the module's internal queue + the consent store's
// localStorage + in-memory state. We re-import the modules fresh per test to
// avoid the singleton carrying across specs.

async function freshModules() {
  vi.resetModules();
  const consent = await import('../../src/lib/analytics/consent');
  const tracker = await import('../../src/lib/analytics/tracker');
  // Wire the consent→tracker subscription (the provider does this in the app).
  tracker.bindConsentListener();
  return { consent, tracker };
}

function clearStorage() {
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
}

describe('F7.7 analytics consent store', () => {
  beforeEach(() => clearStorage());
  afterEach(() => {
    vi.useRealTimers();
    clearStorage();
    vi.restoreAllMocks();
  });

  it('starts as unknown (default-deny) before hydrateConsent is called', async () => {
    const { consent } = await freshModules();
    expect(consent.getConsent()).toBe('unknown');
    expect(consent.consentAllowsTracking()).toBe(false);
  });

  it('grantConsent() flips to granted and persists to localStorage', async () => {
    const { consent } = await freshModules();
    consent.grantConsent();
    expect(consent.getConsent()).toBe('granted');
    expect(consent.consentAllowsTracking()).toBe(true);
    expect(window.localStorage.getItem('XBRAND_ANALYTICS_CONSENT')).toBe('granted');
  });

  it('denyConsent() flips to denied and persists to localStorage', async () => {
    const { consent } = await freshModules();
    consent.denyConsent();
    expect(consent.getConsent()).toBe('denied');
    expect(consent.consentAllowsTracking()).toBe(false);
    expect(window.localStorage.getItem('XBRAND_ANALYTICS_CONSENT')).toBe('denied');
  });

  it('hydrateConsent() reads a persisted granted choice', async () => {
    window.localStorage.setItem('XBRAND_ANALYTICS_CONSENT', 'granted');
    const { consent } = await freshModules();
    expect(consent.getConsent()).toBe('unknown'); // before hydrate
    expect(consent.hydrateConsent()).toBe('granted');
    expect(consent.getConsent()).toBe('granted');
  });

  it('hydrateConsent() treats a corrupt value as unknown and clears it', async () => {
    window.localStorage.setItem('XBRAND_ANALYTICS_CONSENT', 'garbage');
    const { consent } = await freshModules();
    expect(consent.hydrateConsent()).toBe('unknown');
    expect(window.localStorage.getItem('XBRAND_ANALYTICS_CONSENT')).toBeNull();
  });

  it('subscribeToConsent() fires on grant + deny + reset', async () => {
    const { consent } = await freshModules();
    const seen: string[] = [];
    const unsub = consent.subscribeToConsent((next) => seen.push(next));
    consent.grantConsent();
    consent.denyConsent();
    consent.resetConsent();
    expect(seen).toEqual(['granted', 'denied', 'unknown']);
    unsub();
    consent.grantConsent();
    expect(seen).toEqual(['granted', 'denied', 'unknown']); // no further fires
  });
});

describe('F7.7 analytics tracker — privacy gate', () => {
  beforeEach(() => clearStorage());
  afterEach(() => {
    vi.useRealTimers();
    clearStorage();
    vi.restoreAllMocks();
  });

  it('track() is a no-op when consent is unknown (default-deny)', async () => {
    const { tracker } = await freshModules();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    const id = '00000000-0000-4000-8000-000000000001';
    expect(tracker.track('business_view', id)).toBe(false);
    expect(tracker.__queueSnapshot()).toHaveLength(0);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('track() is a no-op when consent is denied', async () => {
    const { consent, tracker } = await freshModules();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    consent.denyConsent();
    const id = '00000000-0000-4000-8000-000000000001';
    expect(tracker.track('business_view', id)).toBe(false);
    expect(tracker.__queueSnapshot()).toHaveLength(0);
  });

  it('track() enqueues when consent is granted', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000001';
    expect(tracker.track('business_view', id)).toBe(true);
    expect(tracker.track('impression', id)).toBe(true);
    expect(tracker.__queueSnapshot()).toHaveLength(2);
  });

  it('consent flip to denied drops the buffered queue', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000001';
    tracker.track('business_view', id);
    tracker.track('impression', id);
    expect(tracker.__queueSnapshot()).toHaveLength(2);
    consent.denyConsent();
    expect(tracker.__queueSnapshot()).toHaveLength(0);
  });
});

describe('F7.7 analytics tracker — validation', () => {
  beforeEach(() => clearStorage());
  afterEach(() => {
    vi.useRealTimers();
    clearStorage();
    vi.restoreAllMocks();
  });

  it('drops an unknown event type (defensive — contract is server-side too)', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000001';
    // @ts-expect-error: deliberately passing a bad type to test the runtime guard
    expect(tracker.track('not_a_real_type', id)).toBe(false);
    expect(tracker.__queueSnapshot()).toHaveLength(0);
  });

  it('drops a non-UUID businessId', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
    consent.grantConsent();
    expect(tracker.track('business_view', 'not-a-uuid')).toBe(false);
    expect(tracker.track('business_view', '12345')).toBe(false);
    expect(tracker.__queueSnapshot()).toHaveLength(0);
  });
});

describe('F7.7 analytics tracker — batching + transport', () => {
  beforeEach(() => {
    clearStorage();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearStorage();
    vi.restoreAllMocks();
  });

  it('flush() sends a POST with the batched events via sendBeacon', async () => {
    const { consent, tracker } = await freshModules();
    const sendBeacon = vi.fn((_url: string, _blob: Blob) => true);
    vi.stubGlobal('navigator', { sendBeacon });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000001';
    tracker.track('business_view', id);
    tracker.track('impression', id);
    await tracker.flush();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const call = sendBeacon.mock.calls[0];
    expect(call).toBeDefined();
    const [url, blob] = call as [string, Blob];
    expect(url).toContain('/analytics/events');
    const text = await blob.text();
    const body = JSON.parse(text);
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ businessId: id, type: 'business_view' });
  });

  it('falls back to fetch(keepalive) when sendBeacon returns false', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => false) });
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000002';
    tracker.track('call_click', id);
    await tracker.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/analytics/events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
  });

  it('falls back to fetch when sendBeacon is absent (old browser)', async () => {
    const { consent, tracker } = await freshModules();
    // No sendBeacon on navigator at all.
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000003';
    tracker.track('share_click', id);
    await tracker.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws on a network error (fail-soft)', async () => {
    const { consent, tracker } = await freshModules();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => false) });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    consent.grantConsent();
    tracker.track('business_view', '00000000-0000-4000-8000-000000000004');
    // flush must not throw — the batch is silently dropped.
    await expect(tracker.flush()).resolves.toBeUndefined();
  });

  it('a flush when consent has flipped to denied drops the queue without POSTing', async () => {
    const { consent, tracker } = await freshModules();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000005';
    tracker.track('business_view', id);
    consent.denyConsent(); // withdraw mid-session
    await tracker.flush();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('caps a batch at ANALYTICS_BATCH_MAX and flushes the overflow', async () => {
    const { consent, tracker } = await freshModules();
    const sendBeacon = vi.fn((_url: string, _blob: Blob) => true);
    vi.stubGlobal('navigator', { sendBeacon });
    consent.grantConsent();
    const id = '00000000-0000-4000-8000-000000000006';
    // Enqueue BATCH_MAX + 1 events. The BATCH_MAX+1th triggers an overflow flush.
    for (let i = 0; i < ANALYTICS_BATCH_MAX + 1; i++) {
      tracker.track('impression', id);
    }
    // The overflow flush fired out of band.
    await vi.waitFor(() => expect(sendBeacon.mock.calls.length).toBeGreaterThanOrEqual(1));
    const call = sendBeacon.mock.calls[0];
    expect(call).toBeDefined();
    const blob = (call as [string, Blob])[1];
    const body = JSON.parse(await blob.text());
    expect(body.events).toHaveLength(ANALYTICS_BATCH_MAX);
    // The overflow event remains in the queue for the next debounce flush.
    expect(tracker.__queueSnapshot().length).toBeGreaterThanOrEqual(1);
  });
});
