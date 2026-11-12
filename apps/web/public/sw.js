/* X-Brand service worker (F5.4).
 *
 * Responsibilities (kept tiny on purpose — caching is conservative; the app
 * shell is server-rendered per locale, so we never pre-cache HTML pages other
 * than the offline fallback):
 *   1. INSTALL — precache the offline shell (offline page per locale, the
 *      manifest, the three PWA icons). Failures don't abort install: a missing
 *      icon at first run is recovered on the next SW update.
 *   2. ACTIVATE — claim clients immediately (so a first install starts serving
 *      navigations through the SW without a reload) and drop old cache
 *      versions.
 *   3. FETCH — network-first for navigations with an offline-page fallback
 *      (the failing URL's locale is parsed so the right /<locale>/offline is
 *      served); stale-while-revalidate for same-origin static assets; pass-
 *      through for everything else (API calls, map tiles, cross-origin).
 *   4. PUSH — parse the JSON payload the B5.4 PushService sends ({ title,
 *      body, url?, tag? }) and post a notification. The `tag` collapses
 *      repeats so a fast notification storm shows one bubble per event.
 *   5. NOTIFICATIONCLICK — focus an existing tab on the target URL if one
 *      exists, otherwise open a new one. The `url` carries the deep-link the
 *      notification should land on (a /account/notifications deep-link by
 *      default); missing url falls back to the SW scope root.
 *
 * The SW is plain JS (lives under /public so Next copies it verbatim) and is
 * registered by `<PwaBootstrap />` (apps/web/src/components/pwa/sw-register).
 */
const VERSION = 'v1';
const CACHE_STATIC = `xbrand-static-${VERSION}`;
const CACHE_RUNTIME = `xbrand-runtime-${VERSION}`;
const KNOWN_LOCALES = ['fa', 'en'];
const DEFAULT_LOCALE = 'fa';

// Assets precached at install: the offline page per known locale (served by
// the [locale]/offline route) and the three PWA icons the manifest + iOS
// splash reference. The manifest itself is tiny and locale-scoped, so it is
// SWR-cached at runtime rather than precached.
const PRECACHE_URLS = [
  ...KNOWN_LOCALES.map((l) => `/${l}/offline`),
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // `addAll` is atomic — a single failure rejects the whole batch. We
      // prefer `put` per URL so a transient 404 (e.g. an icon not yet
      // deployed) does not block SW activation; the runtime SWR path fills
      // the gap on the next request.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res && res.ok) await cache.put(url, res);
          } catch (_e) {
            /* ignored — recovered at runtime */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Extract the locale prefix from a same-origin URL (`/fa/...` → `fa`). */
function localeOf(urlStr) {
  try {
    const u = new URL(urlStr, self.location.origin);
    const m = /^\/(fa|en)(?:\/|$)/.exec(u.pathname);
    return m ? m[1] : null;
  } catch (_e) {
    return null;
  }
}

/** Navigation requests: network-first, fall back to the offline page. */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    return fresh;
  } catch (_err) {
    const cache = await caches.open(CACHE_STATIC);
    const locale = localeOf(request.url) ?? DEFAULT_LOCALE;
    const offline = await cache.match(`/${locale}/offline`);
    if (offline) return offline;
    // Fall back to whichever offline page was precached, then a stale
    // runtime cache hit (better a wrong-locale offline page than a chrome
    // "no internet" screen).
    const anyOffline = await cache.match(new Request('/fa/offline'));
    if (anyOffline) return anyOffline;
    return Response.error();
  }
}

/** Same-origin static assets (/_next/static, /icons, /manifest): SWR. */
async function handleStatic(request) {
  const cache = await caches.open(CACHE_RUNTIME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: pass-through
  // API calls must never be cached (the client owns caching via TanStack Query).
  if (url.pathname.startsWith('/api/')) return;

  const isNavigation =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(handleNavigation(req));
    return;
  }
  // Static asset buckets the SW is allowed to SWR-cache.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('/manifest.webmanifest')
  ) {
    event.respondWith(handleStatic(req));
  }
  // Everything else falls through to the browser default.
});

// ─── Push (B5.4) ────────────────────────────────────────────────────────────
function pushPayload(event) {
  if (!event.data) return null;
  try {
    const json = event.data.json();
    if (json && typeof json === 'object') return json;
  } catch (_e) {
    /* not JSON — try text below */
  }
  const text = event.data.text();
  return text ? { body: text } : null;
}

self.addEventListener('push', (event) => {
  const payload = pushPayload(event) || {};
  const title = payload.title || 'اعلان'; // Persian default — the brand locale
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      url: typeof payload.url === 'string' ? payload.url : '/account/notifications',
    },
    tag: typeof payload.tag === 'string' ? payload.tag : undefined,
    dir: 'rtl',
    lang: 'fa',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const target = new URL(targetUrl, self.location.origin);
      for (const client of allClients) {
        try {
          const u = new URL(client.url);
          if (u.origin === target.origin) {
            if ('focus' in client) await client.focus();
            if (u.pathname !== target.pathname && 'navigate' in client) {
              await client.navigate(target.href);
            }
            return;
          }
        } catch (_e) {
          /* ignore malformed client URLs */
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target.href);
    })(),
  );
});
