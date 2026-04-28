/* ================================
   SERVICE WORKER
   - Caches app shell + fonts on install
   - Chapter data: cache-first
   - Prefetch: concurrent (8 parallel), sliding window
================================ */

const DATA_CACHE   = 'novel-data-v2';
const STATIC_CACHE = 'static-assets-v2';
const FONTS_CACHE  = 'fonts-cache-v2';

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/decrypt.js',
  '/manifest.json',
];

/* ---- helpers ---- */

async function cacheFonts() {
  try {
    const cache = await caches.open(FONTS_CACHE);

    // Cache the CSS sheet first
    const cssRes = await fetch(FONT_CSS_URL);
    if (!cssRes.ok) return;
    await cache.put(FONT_CSS_URL, cssRes.clone());

    // Extract font file URLs from the CSS and cache each one
    const css      = await cssRes.text();
    const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);

    await Promise.allSettled(
      fontUrls.map(url =>
        fetch(url).then(r => { if (r.ok) cache.put(url, r); }).catch(() => {})
      )
    );
  } catch (_) { /* offline at install time — SW fetch handler covers later */ }
}

/**
 * Fetch URLs with a bounded concurrency pool.
 * Skips URLs that are already cached.
 */
async function prefetchConcurrent(urls, concurrency = 8) {
  const cache = await caches.open(DATA_CACHE);
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      try {
        if (await cache.match(url)) continue;          // already cached
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch (_) {}
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(pool);
}

/* ---- lifecycle ---- */

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(c => c.addAll(APP_SHELL)),
      cacheFonts(),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const allowed = [DATA_CACHE, STATIC_CACHE, FONTS_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => allowed.includes(k) ? null : caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---- prefetch message ---- */

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'PREFETCH_CHAPTERS') return;

  const { current, total, ahead, behind } = event.data;
  const start = Math.max(1, current - behind);
  const end   = Math.min(total, current + ahead);

  const urls = [];
  for (let i = start; i <= end; i++) urls.push(`/data/c${i}.json`);

  event.waitUntil(prefetchConcurrent(urls, 8));
});

/* ---- fetch strategy ---- */

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  /* Navigation → network-first, fallback to shell */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          caches.open(STATIC_CACHE).then(c => c.put('/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  /* Chapter data → cache-first */
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => {
          if (res.ok) caches.open(DATA_CACHE).then(c => c.put(event.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  /* Fonts → cache-first (already warmed on install) */
  if (url.hostname.includes('gstatic') || url.hostname.includes('googleapis')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => {
          if (res.ok) caches.open(FONTS_CACHE).then(c => c.put(event.request, res.clone()));
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  /* Static assets → stale-while-revalidate */
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res.ok) caches.open(STATIC_CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
