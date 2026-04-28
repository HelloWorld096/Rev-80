/* ================================
   SERVICE WORKER  —  App-shell only
   Chapter data + fonts are managed by IDB in the main thread.
   The SW's sole job: keep the five JS/CSS/HTML files available
   offline so the app can boot and execute without any network.
================================ */

const SHELL_CACHE = 'app-shell-v3';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/idb.js',
  '/decrypt.js',
  '/script.js',
  '/manifest.json',
];


/* ================================
   INSTALL  —  pre-cache shell files
================================ */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


/* ================================
   ACTIVATE  —  purge old caches
================================ */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.map(k => k !== SHELL_CACHE ? caches.delete(k) : null))
      )
      .then(() => self.clients.claim())
  );
});


/* ================================
   FETCH  —  strategies
================================ */

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  /* ── Navigation: network-first, fall back to cached shell ── */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Keep shell fresh whenever we're online
          caches.open(SHELL_CACHE).then(c => c.put('/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  /* ── App-shell assets: cache-first ── */
  const isShell = APP_SHELL.some(p => url.pathname === p);
  if (isShell || url.hostname === self.location.hostname) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        // Not in cache yet — fetch and cache on first hit
        return fetch(event.request).then(res => {
          if (res.ok) {
            caches.open(SHELL_CACHE).then(c => c.put(event.request, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

  /* ── Everything else (/data/*.json, fonts, external) ──
     Let it fall through to the network.
     IDB in the main thread is the persistence layer for data & fonts.
  ── */
});
