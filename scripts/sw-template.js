/* DeadHangs service worker. Generated per build by scripts/pwa-sw.mjs; do not edit dist/sw.js. */
const VERSION = '__BUILD_ID__';
const CACHE_PREFIX = 'deadhangs-';
const CACHE = CACHE_PREFIX + VERSION;
const SHELL = '/training-log/';
const PRECACHE = __PRECACHE__;
const PRECACHED = new Set(PRECACHE);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The shell is required. A redirected response cannot be served to a navigation.
    const shell = await fetch(SHELL, { cache: 'reload' });
    if (!shell.ok || shell.redirected) throw new Error('shell not cacheable');
    await cache.put(SHELL, shell);
    // Assets are best effort; anything missed is cached on first use.
    await Promise.all(PRECACHE.map(async (path) => {
      try {
        const res = await fetch(path, { cache: 'reload' });
        if (res.ok) await cache.put(path, res);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Navigations: network first so a deploy is never hidden behind old HTML.
// Only a failed network falls back to the saved /training-log/ shell.
async function navigate(request, url) {
  try {
    const res = await fetch(request);
    if (url.pathname === SHELL && res.ok && !res.redirected) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => {});
    }
    return res;
  } catch (_) {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(SHELL);
    return saved || Response.error();
  }
}

// Hashed build files never change under the same name, so the cache wins.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch cross-origin traffic (analytics, ads), the API or Cloudflare internals.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/') || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url));
    return;
  }
  if (url.pathname.startsWith('/_astro/') || PRECACHED.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
