const STATIC_CACHE = "novel-static-v1";
const CHAPTER_CACHE = "novel-chapters-v1";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/decrypt.js",
  "/manifest.json"
];

let FORWARD_CACHE = 130;
let BACKWARD_CACHE = 20;

let currentChapter = 1;



/* INSTALL */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async cache => {

      await cache.addAll(STATIC_FILES);

      // cache google fonts css
      try {
        const res = await fetch(
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
        );
        await cache.put(res.url, res.clone());
      } catch {}

    })
  );

  self.skipWaiting();
});



/* ACTIVATE */

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});



/* FETCH */

self.addEventListener("fetch", event => {

  const url = new URL(event.request.url);

  // chapter json files
  if (url.pathname.startsWith("/data/c")) {

    event.respondWith(chapterStrategy(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});



/* STATIC CACHE */

async function cacheFirst(req) {

  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  if (cached) return cached;

  const res = await fetch(req);
  cache.put(req, res.clone());

  return res;
}



/* CHAPTER CACHE */

async function chapterStrategy(req) {

  const cache = await caches.open(CHAPTER_CACHE);

  const cached = await cache.match(req);

  if (cached) return cached;

  const res = await fetch(req);

  cache.put(req, res.clone());

  const chapter = parseChapterNumber(req.url);

  if (chapter) {

    currentChapter = chapter;

    maintainCacheWindow(chapter);
  }

  return res;
}



function parseChapterNumber(url) {

  const m = url.match(/c(\d+)\.json/);

  return m ? parseInt(m[1]) : null;
}



/* CACHE WINDOW */

async function maintainCacheWindow(center) {

  const start = Math.max(1, center - BACKWARD_CACHE);
  const end = center + FORWARD_CACHE;

  cacheRange(start, end);

  if (end - center < 30) {
    cacheRange(center + FORWARD_CACHE, center + FORWARD_CACHE + 50);
  }
}



async function cacheRange(start, end) {

  const cache = await caches.open(CHAPTER_CACHE);

  for (let i = start; i <= end; i++) {

    const url = `/data/c${i}.json`;

    const exists = await cache.match(url);

    if (!exists) {

      fetch(url)
        .then(res => {
          if (res.ok) cache.put(url, res.clone());
        })
        .catch(() => {});
    }
  }
}



/* MESSAGE API */

self.addEventListener("message", event => {

  const data = event.data;

  if (data.type === "CACHE_AROUND") {

    currentChapter = data.chapter;

    maintainCacheWindow(currentChapter);
  }

  if (data.type === "UPDATE_WINDOW") {

    FORWARD_CACHE = data.forward ?? FORWARD_CACHE;
    BACKWARD_CACHE = data.backward ?? BACKWARD_CACHE;

    maintainCacheWindow(currentChapter);
  }
});
