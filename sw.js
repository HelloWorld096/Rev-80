/* ================================
   SERVICE WORKER
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


/* ================================
   HELPERS
================================ */

/** Fetch and cache Google Fonts CSS + all referenced font files. */
async function cacheFonts() {
  try {
    const fontsCache = await caches.open(FONTS_CACHE);
    const cssRes     = await fetch(FONT_CSS_URL);
    if (!cssRes.ok) return;

    const cssClone = cssRes.clone();
    await fontsCache.put(FONT_CSS_URL, cssClone);

    const css      = await cssRes.text();
    const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);

    await Promise.allSettled(
      fontUrls.map(url =>
        fetch(url)
          .then(r => { if (r.ok) fontsCache.put(url, r); })
          .catch(() => {})
      )
    );
  } catch (_) {
    // Offline at install time — runtime handler below covers it
  }
}

/**
 * Prefetch a list of URLs into DATA_CACHE with bounded concurrency.
 * Already-cached URLs are skipped without hitting the network.
 */
async function prefetchConcurrent(urls, concurrency = 8) {
  const cache = await caches.open(DATA_CACHE);
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      try {
        if (await cache.match(url)) continue;
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch (_) {}
    }
  }

  const n = Math.min(concurrency, urls.length);
  if (n > 0) await Promise.all(Array.from({ length: n }, worker));
}

/** Delete all /data/cN.json entries where N < current from DATA_CACHE. */
async function clearBefore(current) {
  const cache = await caches.open(DATA_CACHE);
  const keys  = await cache.keys();

  await Promise.all(
    keys.map(req => {
      const match = new URL(req.url).pathname.match(/\/data\/c(\d+)\.json$/);
      if (match && parseInt(match[1], 10) < current) return cache.delete(req);
    })
  );
}


/* ================================
   LIFECYCLE
================================ */

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
      .then(keys => Promise.all(
        keys.map(k => allowed.includes(k) ? null : caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});


/* ================================
   MESSAGES FROM MAIN THREAD
================================ */

self.addEventListener('message', event => {
  if (!event.data) return;

  /* Sliding-window chapter prefetch */
  if (event.data.type === 'PREFETCH_CHAPTERS') {
    const { current, total, ahead, behind } = event.data;
    const start = Math.max(1, current - behind);
    const end   = Math.min(total, current + ahead);

    const urls = [];
    for (let i = start; i <= end; i++) urls.push(`/data/c${i}.json`);

    event.waitUntil(prefetchConcurrent(urls, 8));
    return;
  }

  /* Clear chapters before current from cache */
  if (event.data.type === 'CLEAR_BEFORE') {
    event.waitUntil(clearBefore(event.data.current));
    return;
  }
});


/* ================================
   FETCH STRATEGIES
================================ */

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  /* ── Navigation: network-first, SW shell fallback ── */
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

  /* ── Chapter data: cache-first ── */
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

  /* ── Fonts: cache-first (warmed on install) ── */
  if (url.hostname.includes('gstatic') || url.hostname.includes('googleapis')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request)
          .then(res => {
            if (res.ok) caches.open(FONTS_CACHE).then(c => c.put(event.request, res.clone()));
            return res;
          })
          .catch(() => cached)
      )
    );
    return;
  }

  /* ── Static assets: stale-while-revalidate ── */
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
