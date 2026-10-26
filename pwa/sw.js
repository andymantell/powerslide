// Service worker template. pwa/plugin.js fills in VERSION and FILES at build time,
// so every deploy gets a new cache and the browser sees a changed sw.js.
const VERSION = __VERSION__;
const FILES = __FILES__;
const CACHE = `powerslide-${VERSION}`;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so we never precache a stale index.html.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('powerslide-') && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // Page loads: network first so an online player always gets the latest build,
    // falling back to the cached page when offline.
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).catch(() =>
        caches.match('./index.html', { cacheName: CACHE, ignoreVary: true }).then((r) => r || caches.match('./')),
      ),
    );
    return;
  }

  // Everything else is either content-hashed or part of this version's precache.
  e.respondWith(
    // ignoreVary: module scripts send an Origin header the precache requests lacked.
    caches.match(req, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)),
  );
});
