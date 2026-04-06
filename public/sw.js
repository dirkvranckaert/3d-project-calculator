// Service worker v2 — minimal, no caching issues
const CACHE_NAME = 'pc-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-only for everything — avoid caching bugs
self.addEventListener('fetch', () => {});
