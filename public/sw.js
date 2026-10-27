// Lets the game install to the home screen and start without a connection.
// Fresh first: the page and unhashed files (icons, manifest) come from the network
// when it's there, so updates land exactly as they do in a browser tab, with the
// cache only as an offline fallback. Hashed bundles never change, so they're
// served from the cache. The update prompt (src/version.js) unregisters this
// worker and clears the cache before it reloads onto a new build.
// Ported from push-pump-pop.
const CACHE = 'powerslide';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Earlier builds precached everything under per-build caches (powerslide-<hash>).
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  // Version checks must never be served from the cache; drop any that got in.
  const cache = await caches.open(CACHE);
  for (const key of await cache.keys()) if (skip(new URL(key.url))) await cache.delete(key);
  await self.clients.claim();
})()));

// Version checks (version.json, the index.html probe) must always see the live site, never a cached copy.
function skip(url) {
  return url.pathname.endsWith('/version.json') || (url.searchParams.get('v') ?? '').startsWith('probe-');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.cache === 'no-store' || skip(url)) return;
  if (req.mode === 'navigate') e.respondWith(page(req));
  else if (url.pathname.includes('/assets/')) e.respondWith(cached(req));
  else e.respondWith(fresh(req));
});

// The page, from the network if we can, keeping only the bundles it uses.
async function page(req) {
  const cache = await caches.open(CACHE);
  const home = new URL('./', self.registration.scope).href;
  try {
    // Ask the server every time (a quick 304 when nothing changed): GitHub Pages lets
    // browsers keep the page for 10 minutes, which would reopen an old build.
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) {
      const html = await res.clone().text();
      await cache.put(home, res.clone());
      const used = new Set(html.match(/assets\/[^"'\s)]+/g) ?? []);
      for (const key of await cache.keys()) {
        const m = key.url.match(/assets\/[^?#]+/);
        if (m && !used.has(m[0]) && /\.(js|css)$/.test(m[0])) await cache.delete(key);
      }
    }
    return res;
  } catch (err) {
    return (await cache.match(home)) ?? Promise.reject(err);
  }
}

async function cached(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function fresh(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ?? Promise.reject(err);
  }
}
