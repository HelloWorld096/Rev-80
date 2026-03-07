const DATA_CACHE = 'novel-data-v2';
const STATIC_CACHE = 'static-assets-v2';
const FONTS_CACHE = 'fonts-cache-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/decrypt.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const allowedCaches = [DATA_CACHE, STATIC_CACHE, FONTS_CACHE];
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (!allowedCaches.includes(key)) return caches.delete(key);
      })
    )).then(() => self.clients.claim())
  );
});

// PREFETCH LOGIC
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'PREFETCH_CHAPTERS') return;

  const { current, total, ahead, behind } = event.data;
  const start = Math.max(1, current - behind);
  const end = Math.min(total, current + ahead);

  // Keep the worker alive until all fetches in this batch settle
  event.waitUntil(
    caches.open(DATA_CACHE).then(async (cache) => {
      for (let i = start; i <= end; i++) {
        const url = `/data/c${i}.json`;
        const matched = await cache.match(url);

        if (!matched) {
          try {
            const response = await fetch(url);
            if (response.ok) {
              await cache.put(url, response.clone());
            }
          } catch (e) {
            console.error(`Failed to prefetch chapter ${i}`);
          }
        }
      }
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // 1. Navigation (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Data files (Chapters) - Cache First
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(event.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // 3. Fonts & Static Assets - Stale While Revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(res => {
        const clone = res.clone();
        const cacheName = (url.hostname.includes('fonts')) ? FONTS_CACHE : STATIC_CACHE;
        caches.open(cacheName).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
