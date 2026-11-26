const CACHE_NAME = 'xiangqi-blast-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('xiangqi-blast-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isNetworkFirstRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const p = url.pathname;
  return (
    p.endsWith('/') ||
    p.endsWith('.html') ||
    p.endsWith('manifest.webmanifest') ||
    p.endsWith('.wasm') ||
    p.endsWith('xiangqiblast-engine.js') ||
    p.includes('/levels/')
  );
}

function isCacheFirstAsset(url) {
  const p = url.pathname;
  return p.includes('/assets/') || p.includes('/audio/') || p.includes('/logos/');
}

async function networkFirst(request, isNavigate) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      void cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigate) {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      void cache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (isNetworkFirstRequest(request, url)) {
    event.respondWith(networkFirst(request, request.mode === 'navigate'));
    return;
  }

  if (isCacheFirstAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
