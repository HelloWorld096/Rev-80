/* ================================
   ICONS  (currentColor → works in dark mode)
================================ */

const Icons = {
  left:  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="9 6 15 12 9 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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
   PREFETCH CONFIG  (mutable — setDefaults() can change these)
================================ */

let PREFETCH_AHEAD  = 150;   // chapters to cache forward
let PREFETCH_BEHIND = 50;    // chapters to keep behind
let PREFETCH_REFILL = 50;    // re-trigger when remaining-ahead drops below this

let minCached = Infinity;
let maxCached = 0;


/* ================================
   PREFETCH MANAGEMENT
================================ */

function managePrefetch(chap, force = false) {
  const remainingAhead = maxCached - chap;

  if (force || maxCached === 0 || remainingAhead < PREFETCH_REFILL || chap < minCached) {
    minCached = Math.max(1, chap - PREFETCH_BEHIND);
    maxCached = Math.min(totalChapters, chap + PREFETCH_AHEAD);

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type:    'PREFETCH_CHAPTERS',
        current: chap,
        total:   totalChapters,
        ahead:   PREFETCH_AHEAD,
        behind:  PREFETCH_BEHIND,
      });
    }
  }
}


/* ================================
   CONSOLE STATS  (printed on every chapter change)
================================ */

function printConsoleStats() {
  console.clear();

  const ahead = maxCached - currentChapter;
  const behind = currentChapter - minCached;
  const until = Math.max(0, ahead - PREFETCH_REFILL);
  const totalCached = maxCached - minCached + 1;

  // Header
  console.log(`%c NOVEL READER STATE: Chapter ${currentChapter} / ${totalChapters}`, 'font-weight: bold; color: #617AC1;');

  // Table Data
  console.table({
    "Current Position": { value: currentChapter, detail: `of ${totalChapters}` },
    "Cache Range": { value: `${minCached} → ${maxCached}`, detail: `(${totalCached} ch total)` },
    "Buffer Ahead": { value: ahead, detail: ahead < PREFETCH_REFILL ? "TRIGGERED" : `Refill at < ${PREFETCH_REFILL}` },
    "Next Update": { value: until === 0 ? "NOW" : `${until} chapters`, detail: `at ch ${currentChapter + until}` }
  });

  printHelp();
}

function printHelp() {
  console.group("%cAVAILABLE COMMANDS", "color: #617AC1; font-weight: bold;");

  const commands = [
    ["cacheAhead(n)", "Cache N chapters forward"],
    ["clearPrevious()", "Wipe cache before current chapter"],
    ["setDefaults(x,y,z)", "Update (Ahead, Behind, Trigger)"],
    ["updateCacheWindow()", "Force immediate re-cache"],
    ["printHelp()", "Display this list"]
  ];

  commands.forEach(([cmd, desc]) => {
    console.log(`%c${cmd.padEnd(22)} %c| %c${desc}`, "color: #617AC1; font-family: monospace;", "color: #444;", "color: #888;");
  });

  console.groupEnd();

  // Subtle footer for system values
  console.log(
    `%cSystem Config: Ahead=${PREFETCH_AHEAD} Behind=${PREFETCH_BEHIND} Trigger=${PREFETCH_REFILL}`,
    "color: #555; font-size: 10px;"
  );
}

/* ================================
   CONSOLE API  (attached to window)
================================ */

/** Ensure n chapters ahead of current are cached. */
window.cacheAhead = function(n) {
  if (typeof n !== 'number' || n <= 0) {
    console.warn('cacheAhead(n): n must be a positive number');
    return;
  }
  if (n <= PREFETCH_AHEAD) {
    console.log(`Already caching %c${PREFETCH_AHEAD}%c ahead — use n > ${PREFETCH_AHEAD} to extend.`, C.bold, C.reset);
    return;
  }
  const target = Math.min(totalChapters, currentChapter + n);
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'PREFETCH_CHAPTERS',
      current: currentChapter,
      total:   totalChapters,
      ahead:   n,
      behind:  0,
    });
    maxCached = Math.max(maxCached, target);
    console.log(`%ccacheAhead%c: requesting ch ${currentChapter} → ch ${target}`, C.accent, C.reset);
  } else {
    console.warn('Service Worker not ready yet.');
  }
};

/** Delete cached chapter files that come before the current chapter. */
window.clearPrevious = function() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type:    'CLEAR_BEFORE',
      current: currentChapter,
    });
    minCached = currentChapter;
    console.log(`%cclearPrevious%c: requested deletion of chapters < ${currentChapter}`, C.accent, C.reset);
  } else {
    console.warn('Service Worker not ready yet.');
  }
};

/**
 * Update prefetch defaults and force an immediate re-cache.
 * @param {number} x  chapters ahead
 * @param {number} y  chapters behind
 * @param {number} z  refill trigger (re-cache when ahead < z)
 */
window.setDefaults = function(x, y, z) {
  let changed = false;
  if (x !== undefined && typeof x === 'number') { PREFETCH_AHEAD  = x; changed = true; }
  if (y !== undefined && typeof y === 'number') { PREFETCH_BEHIND = y; changed = true; }
  if (z !== undefined && typeof z === 'number') { PREFETCH_REFILL = z; changed = true; }

  if (!changed) {
    console.warn('setDefaults(ahead, behind, trigger): pass at least one numeric argument.');
    return;
  }

  console.log(
    `%csetDefaults%c: ahead=%c${PREFETCH_AHEAD}%c  behind=%c${PREFETCH_BEHIND}%c  trigger=<%c${PREFETCH_REFILL}`,
    C.accent, C.reset, C.bold, C.reset, C.bold, C.reset, C.bold
  );
  managePrefetch(currentChapter, true);
  printConsoleStats();
};

/** Force a cache refresh with current defaults. */
window.updateCacheWindow = function() {
  managePrefetch(currentChapter, true);
  printConsoleStats();
};

/** Print the function manual. */
window.printHelp = printHelp;


/* ================================
   STORAGE
================================ */

function saveChapterState() { localStorage.setItem('lastChapter', currentChapter); }
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
    contentEl().innerHTML = `<p>Chapter ${n} not found or decryption failed.</p>`;
    fadeIn();
    console.error('[loadChapter]', e);
  }

  loading = false;
}


/* ================================
   POPUP  —  paginated, 200 chapters per page
================================ */

const PAGE_SIZE = 200;
let popupPage   = 0;

function totalPopupPages() { return Math.ceil(totalChapters / PAGE_SIZE); }

function openChapterPopup() {
  // Jump straight to the page that contains the current chapter
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

  // Pagination controls
  document.getElementById('popupPageInfo').textContent =
    `${start}–${end} of ${totalChapters}`;
  document.getElementById('popupPrevPage').disabled = (popupPage === 0);
  document.getElementById('popupNextPage').disabled = (popupPage >= pages - 1);

  // Build buttons
  const frag = document.createDocumentFragment();
  for (let ch = start; ch <= end; ch++) {
    const btn = document.createElement('button');
    btn.textContent     = `${ch}`;
    btn.dataset.chapter = ch;

    if (ch === currentChapter) {
      btn.classList.add('active');
    } else if (ch >= minCached && ch <= maxCached) {
      btn.classList.add('cached');
    }

    btn.addEventListener('click', () => {
      loadDecryptedChapter(ch);
      closePopup();
    });

    frag.appendChild(btn);
  }

  list.innerHTML = '';
  list.appendChild(frag);

  // Scroll active button into view
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
        if (stored === null) {
          // User dismissed — keep prompting (required to read the novel)
          stored = null;
          continue;
        }
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

  /* Icons */
  ['navLeftTop','navLeftBottom'].forEach(id  => document.getElementById(id).innerHTML  = Icons.left);
  ['navRightTop','navRightBottom'].forEach(id => document.getElementById(id).innerHTML = Icons.right);

  /* Chapter navigation */
  document.getElementById('navLeftTop').onclick     = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navLeftBottom').onclick  = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navRightTop').onclick    = () => loadDecryptedChapter(currentChapter + 1);
  document.getElementById('navRightBottom').onclick = () => loadDecryptedChapter(currentChapter + 1);

  /* Popup open */
  document.getElementById('chapterNumber').onclick       = openChapterPopup;
  document.getElementById('chapterNumberBottom').onclick = openChapterPopup;

  /* Close popup on backdrop click */
  document.getElementById('chapterPopup').addEventListener('click', e => {
    if (e.target === document.getElementById('chapterPopup')) closePopup();
  });

  /* Popup pagination */
  document.getElementById('popupPrevPage').addEventListener('click', () => {
    if (popupPage > 0) { popupPage--; renderPopupPage(); }
  });
  document.getElementById('popupNextPage').addEventListener('click', () => {
    if (popupPage < totalPopupPages() - 1) { popupPage++; renderPopupPage(); }
  });

  /* Keyboard */
  document.addEventListener('keydown', e => {
    const popupOpen = document.getElementById('chapterPopup').style.display === 'flex';
    if (popupOpen) {
      if (e.key === 'Escape') closePopup();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') loadDecryptedChapter(currentChapter + 1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   loadDecryptedChapter(currentChapter - 1);
  });

  /* Scroll save (debounced, suppressed mid-load) */
  window.addEventListener('scroll', () => {
    if (loading) return;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveScrollState, 250);
  }, { passive: true });

  /* Resolve start */
  const { chapter, scroll } = determineDesiredInitial();
  const initialText = await ensurePasswordAndFetch(chapter);
  loadDecryptedChapter(chapter, scroll, initialText);

  /* Service Worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] registered', reg.scope))
      .catch(err => console.error('[SW] registration failed', err));
  }
});

