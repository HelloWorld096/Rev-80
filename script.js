/* ================================
   ICONS
================================ */

const Icons = {
  left:  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="9 6 15 12 9 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};


/* ================================
   CONSOLE STYLE TOKENS  (was missing in original — fixes ReferenceError)
================================ */

const C = {
  accent: 'color:#617AC1; font-weight:bold;',
  bold:   'font-weight:bold;',
  reset:  'color:inherit; font-weight:normal;',
  dim:    'color:#666; font-size:11px;',
};


/* ================================
   GLOBAL STATE
================================ */

const totalChapters = 2334;

let currentChapter = 1;
let password       = null;
let loading        = false;
let scrollTimeout  = null;


/* ================================
   PREFETCH CONFIG  (mutable via setDefaults())
================================ */

let PREFETCH_AHEAD  = 150;
let PREFETCH_BEHIND = 50;
let PREFETCH_REFILL = 50;


/* ================================
   IDB CHAPTER TRACKING
   cachedChapterSet is the source of truth for what is in IDB.
   minCached / maxCached are derived and kept in sync for O(1) stats.
================================ */

const cachedChapterSet = new Set();
let minCached = Infinity;
let maxCached = 0;

/** Call once at startup to sync in-memory set with IDB reality. */
async function initCachedSet() {
  const keys = await idbGetAllKeys('chapters');
  for (const k of keys) {
    cachedChapterSet.add(k);
    if (k < minCached) minCached = k;
    if (k > maxCached) maxCached = k;
  }
}

function markCached(n) {
  cachedChapterSet.add(n);
  if (n < minCached) minCached = n;
  if (n > maxCached) maxCached = n;
}


/* ================================
   PREFETCH QUEUE
   Concurrent IDB-backed background fetcher.
   Chapters already in IDB are skipped without a network request.
================================ */

const prefetchQ = (() => {
  const CONCURRENCY = 8;
  const pending = [];          // ordered list of chapter numbers
  const pendingSet = new Set();// O(1) duplicate guard
  let   active  = 0;

  function pump() {
    while (active < CONCURRENCY && pending.length > 0) {
      const n = pending.shift();
      pendingSet.delete(n);
      if (cachedChapterSet.has(n)) { pump(); return; }   // already cached — skip
      active++;
      _fetch(n).finally(() => { active--; pump(); });
    }
  }

  async function _fetch(n) {
    try {
      if (cachedChapterSet.has(n)) return;               // double-check after await
      const res = await fetch(`/data/c${n}.json`);
      if (!res.ok) return;
      const data = await res.json();
      await idbPut('chapters', { ...data, id: n });
      markCached(n);
    } catch (_) { /* network unavailable — silently skip */ }
  }

  return {
    /** Enqueue an array of chapter numbers (duplicates ignored). */
    add(chapters) {
      for (const n of chapters) {
        if (!cachedChapterSet.has(n) && !pendingSet.has(n)) {
          pending.push(n);
          pendingSet.add(n);
        }
      }
      pump();
    },
    /** Drop all waiting (in-flight tasks finish naturally). */
    flush() { pending.length = 0; pendingSet.clear(); },
    get size() { return pending.length; },
    get activeCount() { return active; },
  };
})();


/* ================================
   PREFETCH MANAGEMENT
================================ */

function managePrefetch(chap, force = false) {
  const remainingAhead = maxCached - chap;
  if (!force && maxCached !== 0 && remainingAhead >= PREFETCH_REFILL && chap >= minCached) return;

  const start = Math.max(1, chap - PREFETCH_BEHIND);
  const end   = Math.min(totalChapters, chap + PREFETCH_AHEAD);

  const chapters = [];
  for (let i = chap + 1; i <= end; i++) chapters.push(i);    // ahead first (priority)
  for (let i = chap - 1; i >= start; i--) chapters.push(i);  // then behind

  prefetchQ.add(chapters);
}


/* ================================
   FONT LOADING  —  IDB-backed
   On first online visit: fetches Google Fonts CSS + all woff2 files,
   stores them in IDB under 'assets'.
   On subsequent / offline visits: reconstructs @font-face CSS from IDB
   blobs and injects it into the document — no network required.
================================ */

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap';

function _fontFileKey(url) {
  // Use the unique filename portion of the gstatic URL as the IDB key.
  return 'font-file-' + new URL(url).pathname.split('/').pop();
}

async function _injectFromIDB(meta) {
  let css = meta.css;

  await Promise.allSettled(meta.urls.map(async url => {
    const key   = _fontFileKey(url);
    const asset = await idbGet('assets', key);
    if (asset?.buf) {
      const blob    = new Blob([asset.buf], { type: 'font/woff2' });
      const blobUrl = URL.createObjectURL(blob);
      css = css.split(url).join(blobUrl);   // replaceAll without regex
    }
  }));

  const style = document.createElement('style');
  style.id    = 'inter-font-face';
  style.textContent = css;
  document.head.appendChild(style);
}

async function initFonts() {
  // 1. Warm path: rebuild @font-face from IDB blobs
  const meta = await idbGet('assets', 'font-inter-meta');
  if (meta) {
    await _injectFromIDB(meta);
    return;
  }

  // 2. Cold path: fetch CSS + all font files and persist them
  try {
    const css  = await fetch(FONT_CSS_URL).then(r => { if (!r.ok) throw 0; return r.text(); });
    const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]))];

    // Store metadata first (enables warm path on next load even if tab closes mid-fetch)
    const newMeta = { key: 'font-inter-meta', css, urls };
    await idbPut('assets', newMeta);

    // Fetch all woff2 files concurrently and store as ArrayBuffers
    await Promise.allSettled(urls.map(async url => {
      try {
        const buf = await fetch(url).then(r => r.arrayBuffer());
        await idbPut('assets', { key: _fontFileKey(url), buf });
      } catch (_) { /* individual file may fail — graceful degradation */ }
    }));

    // Inject (will use blob: URLs for whichever files succeeded)
    await _injectFromIDB(newMeta);

  } catch (_) {
    // Offline on very first ever load — system sans-serif is the fallback
    console.info('[fonts] Could not load Inter — using system fallback');
  }
}


/* ================================
   CONSOLE STATS
================================ */

function printConsoleStats() {
  console.clear();

  const ahead      = maxCached - currentChapter;
  const behind     = currentChapter - minCached;
  const until      = Math.max(0, ahead - PREFETCH_REFILL);
  const totalCached = cachedChapterSet.size;

  console.log(`%c NOVEL READER  |  Chapter ${currentChapter} / ${totalChapters}`, 'font-weight:bold; color:#617AC1;');

  console.table({
    'Current Position': { value: currentChapter,             detail: `of ${totalChapters}` },
    'IDB Cache Size':   { value: `${totalCached} chapters`,  detail: `${minCached} → ${maxCached}` },
    'Buffer Ahead':     { value: ahead,                      detail: ahead < PREFETCH_REFILL ? '⚡ TRIGGERED' : `Refill at < ${PREFETCH_REFILL}` },
    'Fetch Queue':      { value: prefetchQ.size,             detail: `${prefetchQ.activeCount} active workers` },
    'Next Refill':      { value: until === 0 ? 'NOW' : `in ${until} ch`, detail: `at ch ${currentChapter + until}` },
  });

  printHelp();
}

function printHelp() {
  console.group('%cCOMMANDS', 'color:#617AC1; font-weight:bold;');
  [
    ['cacheAhead(n)',      'Fetch N chapters forward into IDB'],
    ['clearPrevious()',   'Delete IDB entries before current chapter'],
    ['setDefaults(x,y,z)','Update (Ahead, Behind, Trigger) + re-cache'],
    ['updateCacheWindow()','Force immediate re-cache with current defaults'],
    ['printHelp()',        'Show this list'],
  ].forEach(([cmd, desc]) => {
    console.log(`%c${cmd.padEnd(22)} %c| %c${desc}`, C.accent, 'color:#444;', 'color:#888;');
  });
  console.groupEnd();
  console.log(`%cConfig: Ahead=${PREFETCH_AHEAD}  Behind=${PREFETCH_BEHIND}  Trigger=${PREFETCH_REFILL}`, C.dim);
}


/* ================================
   CONSOLE API  (window-attached)
================================ */

window.cacheAhead = function(n) {
  if (typeof n !== 'number' || n <= 0) { console.warn('cacheAhead(n): n must be a positive number'); return; }
  const end = Math.min(totalChapters, currentChapter + n);
  const chapters = [];
  for (let i = currentChapter + 1; i <= end; i++) chapters.push(i);
  prefetchQ.add(chapters);
  console.log(`%ccacheAhead%c: queued ch ${currentChapter + 1} → ${end}`, C.accent, C.reset);
};

window.clearPrevious = async function() {
  await idbDeleteBelow('chapters', currentChapter);
  for (const k of cachedChapterSet) { if (k < currentChapter) cachedChapterSet.delete(k); }
  minCached = currentChapter;
  prefetchQ.flush();
  console.log(`%cclearPrevious%c: deleted chapters < ${currentChapter} from IDB`, C.accent, C.reset);
  printConsoleStats();
};

window.setDefaults = function(x, y, z) {
  let changed = false;
  if (typeof x === 'number') { PREFETCH_AHEAD  = x; changed = true; }
  if (typeof y === 'number') { PREFETCH_BEHIND = y; changed = true; }
  if (typeof z === 'number') { PREFETCH_REFILL = z; changed = true; }
  if (!changed) { console.warn('setDefaults(ahead, behind, trigger): pass at least one number.'); return; }
  console.log(`%csetDefaults%c: ahead=%c${PREFETCH_AHEAD}%c  behind=%c${PREFETCH_BEHIND}%c  trigger=%c${PREFETCH_REFILL}`,
    C.accent, C.reset, C.bold, C.reset, C.bold, C.reset, C.bold);
  managePrefetch(currentChapter, true);
  printConsoleStats();
};

window.updateCacheWindow = function() {
  managePrefetch(currentChapter, true);
  printConsoleStats();
};

window.printHelp = printHelp;


/* ================================
   STORAGE  —  scroll + chapter position
================================ */

function saveChapterState() { localStorage.setItem('lastChapter',    currentChapter); }
function saveScrollState()  { localStorage.setItem('scrollPosition', window.scrollY); }


/* ================================
   INITIAL STATE
================================ */

function determineDesiredInitial() {
  const storedChap   = localStorage.getItem('lastChapter');
  const storedScroll = localStorage.getItem('scrollPosition');
  const urlChap      = new URLSearchParams(window.location.search).get('chapter');

  let chapter = 1, scroll = 0;

  if (urlChap) {
    chapter = parseInt(urlChap, 10) || 1;
    if (storedChap && parseInt(storedChap, 10) === chapter) {
      scroll = storedScroll ? parseInt(storedScroll, 10) : 0;
    }
  } else if (storedChap) {
    chapter = parseInt(storedChap, 10) || 1;
    scroll  = storedScroll ? parseInt(storedScroll, 10) : 0;
  }

  return { chapter, scroll };
}

function updateUrl() {
  history.replaceState({}, '', `?chapter=${currentChapter}`);
}


/* ================================
   TEXT PARSING
================================ */

function parseChapter(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<p>${l}</p>`)
    .join('');
}

function cleanTitle(line) {
  return line.replace(/^chapter\s*\d+\s*[-—–:：.]*/i, '').trim();
}


/* ================================
   FADE HELPERS
================================ */

const titleEl   = () => document.getElementById('chapterTitle');
const contentEl = () => document.getElementById('chapterContent');

function fadeOut() {
  titleEl().classList.add('fading');
  contentEl().classList.add('fading');
}

function fadeIn() {
  void contentEl().offsetHeight;   // force reflow
  titleEl().classList.remove('fading');
  contentEl().classList.remove('fading');
}


/* ================================
   LOAD CHAPTER
================================ */

async function loadDecryptedChapter(n, scrollPos = 0, preloadedText = null) {
  if (loading) return;
  if (n < 1 || n > totalChapters) return;

  loading = true;
  if (scrollTimeout) { clearTimeout(scrollTimeout); scrollTimeout = null; }

  currentChapter = n;
  saveChapterState();
  updateUrl();

  document.getElementById('chapterNumber').textContent       = `Chapter ${n}`;
  document.getElementById('chapterNumberBottom').textContent = `Chapter ${n}`;

  fadeOut();

  try {
    const txt   = preloadedText || await loadChapter(n, password);
    const lines = txt.trim().split('\n').filter(l => l.trim().length > 0);
    const title = cleanTitle(lines[0] || `Chapter ${n}`);
    const body  = lines.slice(1).join('\n\n');

    // Mark current chapter as cached (it was just loaded, so IDB has it)
    markCached(n);

    titleEl().textContent = title;
    contentEl().innerHTML = parseChapter(body);
    document.title        = `${n} | ${title}`;

    managePrefetch(n);
    printConsoleStats();

    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPos, behavior: 'auto' });
      fadeIn();
    });

  } catch (e) {
    titleEl().textContent = 'Error';
    contentEl().innerHTML = `<p>Chapter ${n} could not be loaded. ${navigator.onLine ? 'Decryption may have failed.' : 'You appear to be offline and this chapter is not cached.'}</p>`;
    fadeIn();
    console.error('[loadChapter]', e);
  }

  loading = false;
}


/* ================================
   POPUP  —  paginated, 200 chapters per page
================================ */

const PAGE_SIZE = 200;
let   popupPage = 0;

function totalPopupPages() { return Math.ceil(totalChapters / PAGE_SIZE); }

function openChapterPopup() {
  popupPage = Math.floor((currentChapter - 1) / PAGE_SIZE);
  renderPopupPage();
  document.getElementById('chapterPopup').style.display = 'flex';
}

function closePopup() {
  document.getElementById('chapterPopup').style.display = 'none';
}

function renderPopupPage() {
  const list  = document.getElementById('chapterList');
  const start = popupPage * PAGE_SIZE + 1;
  const end   = Math.min(totalChapters, start + PAGE_SIZE - 1);
  const pages = totalPopupPages();

  document.getElementById('popupPageInfo').textContent = `${start}–${end} of ${totalChapters}`;
  document.getElementById('popupPrevPage').disabled = (popupPage === 0);
  document.getElementById('popupNextPage').disabled = (popupPage >= pages - 1);

  const frag = document.createDocumentFragment();

  for (let ch = start; ch <= end; ch++) {
    const btn = document.createElement('button');
    btn.textContent     = `${ch}`;
    btn.dataset.chapter = ch;

    if (ch === currentChapter) {
      btn.classList.add('active');
    } else if (cachedChapterSet.has(ch)) {
      // IDB-accurate: only mark cached if it's actually in IndexedDB
      btn.classList.add('cached');
    }

    btn.addEventListener('click', () => { loadDecryptedChapter(ch); closePopup(); });
    frag.appendChild(btn);
  }

  list.innerHTML = '';
  list.appendChild(frag);

  requestAnimationFrame(() => {
    const active = list.querySelector('button.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  });
}


/* ================================
   PASSWORD
================================ */

async function ensurePasswordAndFetch(targetChapter) {
  let stored = localStorage.getItem('novelKey');

  while (true) {
    try {
      if (!stored) {
        stored = prompt('Enter decryption password:');
        if (stored === null) { stored = null; continue; }
      }

      const txt = await loadChapter(targetChapter, stored);

      password = stored;
      localStorage.setItem('novelKey', password);
      return txt;

    } catch (_) {
      stored = null;
      localStorage.removeItem('novelKey');
      alert('Wrong password — try again.');
    }
  }
}


/* ================================
   INIT
================================ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── Register Service Worker ── */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] registered', reg.scope))
      .catch(err => console.error('[SW] registration failed', err));
  }

  /* ── Sync IDB state into memory ── */
  await initCachedSet();

  /* ── Load fonts from IDB (or fetch + cache + inject) ── */
  initFonts();   // non-blocking — system font shows until Inter is ready

  /* ── Icons ── */
  ['navLeftTop','navLeftBottom'].forEach(id  => document.getElementById(id).innerHTML  = Icons.left);
  ['navRightTop','navRightBottom'].forEach(id => document.getElementById(id).innerHTML = Icons.right);

  /* ── Navigation ── */
  document.getElementById('navLeftTop').onclick     = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navLeftBottom').onclick  = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navRightTop').onclick    = () => loadDecryptedChapter(currentChapter + 1);
  document.getElementById('navRightBottom').onclick = () => loadDecryptedChapter(currentChapter + 1);

  /* ── Popup open ── */
  document.getElementById('chapterNumber').onclick       = openChapterPopup;
  document.getElementById('chapterNumberBottom').onclick = openChapterPopup;

  /* ── Close popup on backdrop click ── */
  document.getElementById('chapterPopup').addEventListener('click', e => {
    if (e.target === document.getElementById('chapterPopup')) closePopup();
  });

  /* ── Popup pagination ── */
  document.getElementById('popupPrevPage').addEventListener('click', () => {
    if (popupPage > 0) { popupPage--; renderPopupPage(); }
  });
  document.getElementById('popupNextPage').addEventListener('click', () => {
    if (popupPage < totalPopupPages() - 1) { popupPage++; renderPopupPage(); }
  });

  /* ── Keyboard ── */
  document.addEventListener('keydown', e => {
    const popupOpen = document.getElementById('chapterPopup').style.display === 'flex';
    if (popupOpen) { if (e.key === 'Escape') closePopup(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') loadDecryptedChapter(currentChapter + 1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   loadDecryptedChapter(currentChapter - 1);
  });

  /* ── Scroll save (debounced) ── */
  window.addEventListener('scroll', () => {
    if (loading) return;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveScrollState, 250);
  }, { passive: true });

  /* ── First chapter load ── */
  const { chapter, scroll } = determineDesiredInitial();
  const initialText = await ensurePasswordAndFetch(chapter);
  loadDecryptedChapter(chapter, scroll, initialText);
});
