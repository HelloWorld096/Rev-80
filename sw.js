const CORE_CACHE = 'novel-core-v1';
const FONTS_CACHE = 'novel-fonts-v1';
const CHAPTER_CACHE = 'novel-chapters-v1';

// We include manifest.json here so the salt is available offline immediately
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './decrypt.js',
  './manifest.json' 
];

// Generates the correct URL based on your decrypt.js logic
function getChapterUrl(chapterNumber) {
  return `./data/c${chapterNumber}.json`; 
}

let highestCachedChapter = 0;

// 1. Install & Cache Core Assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CORE_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// 2. Clean up old caches on activation
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// 3. Listen for window updates from index.html
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHAPTER_CHANGED') {
    const { chapter, forward, backward, force } = event.data;

    // Update if forced via console, if SW just woke up, or if we are within 30 chapters of the edge
    if (force || highestCachedChapter === 0 || (highestCachedChapter - chapter) < 30) {
      event.waitUntil(updateChapterCacheWindow(chapter, forward, backward));
    }
  }
});

async function updateChapterCacheWindow(currentChapter, forward, backward) {
  const cache = await caches.open(CHAPTER_CACHE);
  const start = Math.max(1, currentChapter - backward);
  const end = currentChapter + forward; 

  const fetchPromises = [];

  // Fetch missing chapters in the sliding window
  for (let i = start; i <= end; i++) {
    const url = getChapterUrl(i);
    const req = new Request(url);
    
    const isCached = await cache.match(req);
    if (!isCached) {
      fetchPromises.push(
        fetch(req).then(response => {
          if (response.ok) cache.put(req, response.clone());
        }).catch(() => {
          // Silently fail if offline; we'll retry when the network returns
        })
      );
    }
  }

  await Promise.all(fetchPromises);
  highestCachedChapter = end;

  // Evict chapters that have fallen out of the backward window
  const keys = await cache.keys();
  for (const request of keys) {
    // Matches urls like "data/c12.json" and extracts the "12"
    const match = request.url.match(/data\/c(\d+)\.json$/);
    if (match) {
      const chNum = parseInt(match[1], 10);
      if (chNum < start || chNum > end) {
        await cache.delete(request);
      }
    }
  }
}

// 4. Intercept network requests (Cache-First Strategy)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Auto-cache Google Fonts
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const responseClone = response.clone();
          caches.open(FONTS_CACHE).then(cache => cache.put(event.request, responseClone));
          return response;
        });
      })
    );
    return;
  }

  // Handle all other requests (HTML, JS, CSS, manifest, and Chapter JSONs)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Return cached version if it exists, otherwise go to the network
      return cachedResponse || fetch(event.request).catch(() => {
        // If fetch fails (offline) and not in cache, let it fail gracefully
        console.warn('Offline and resource not cached:', event.request.url);
      });
    })
  );
});
