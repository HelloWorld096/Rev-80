const STATIC_CACHE = "novel-static-v1";
const CHAPTER_CACHE = "novel-chapters-v1";

const STATIC_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./decrypt.js",
  "./manifest.json"
];

let FORWARD = 130;
let BACKWARD = 20;
let currentChapter = 1;



/* INSTALL */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});



/* ACTIVATE */

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});



/* FETCH HANDLER */

self.addEventListener("fetch", event => {

  const url = new URL(event.request.url);

  // chapter files
  if (url.pathname.includes("/data/c")) {
    event.respondWith(handleChapter(event.request));
    return;
  }

  // google fonts
  if (url.hostname.includes("fonts")) {
    event.respondWith(cacheFonts(event.request));
    return;
  }

  // static assets
  event.respondWith(cacheFirst(event.request));
});



/* CACHE FIRST */

async function cacheFirst(req) {

  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  if (cached) return cached;

  try {
    const res = await fetch(req);
    cache.put(req, res.clone());
    return res;
  } catch {
    return cached;
  }
}



/* FONT CACHE */

async function cacheFonts(req) {

  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  if (cached) return cached;

  const res = await fetch(req);
  cache.put(req, res.clone());
  return res;
}



/* CHAPTER CACHE */

async function handleChapter(req) {

  const cache = await caches.open(CHAPTER_CACHE);

  const cached = await cache.match(req);
  if (cached) return cached;

  try {

    const res = await fetch(req);

    cache.put(req, res.clone());

    const num = extractChapter(req.url);

    if (num) {
      currentChapter = num;
      maintainWindow(num);
    }

    return res;

  } catch {

    return cached;
  }
}



/* PARSE CHAPTER NUMBER */

function extractChapter(url) {

  const m = url.match(/c(\d+)\.json/);

  if (!m) return null;

  return parseInt(m[1]);
}



/* CACHE WINDOW */

async function maintainWindow(center) {

  const start = Math.max(1, center - BACKWARD);
  const end = center + FORWARD;

  cacheRange(start, end);

  if (end - center < 30) {
    cacheRange(end, end + 50);
  }
}



/* CACHE RANGE */

async function cacheRange(start, end) {

  const cache = await caches.open(CHAPTER_CACHE);

  for (let i = start; i <= end; i++) {

    const url = `./data/c${i}.json`;

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

    maintainWindow(currentChapter);
  }

  if (data.type === "UPDATE_WINDOW") {

    FORWARD = data.forward ?? FORWARD;
    BACKWARD = data.backward ?? BACKWARD;

    maintainWindow(currentChapter);
  }

});
