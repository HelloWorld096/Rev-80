const Icons = {
  left:  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="9 6 15 12 9 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};


const totalChapters = 2334;

let currentChapter = 1;
let password       = null;

let popupInitialized = false;
let scrollTimeout    = null;
let loading          = false;


const PREFETCH_AHEAD  = 150;
const PREFETCH_BEHIND = 50;
const PREFETCH_REFILL = 50;  // trigger when remaining-forward drops below this

let minCached = Infinity;
let maxCached = 0;

function managePrefetch(currentChap, force = false) {
  const remainingForward = maxCached - currentChap;

  if (
    force          ||
    maxCached === 0 ||
    remainingForward < PREFETCH_REFILL ||
    currentChap < minCached
  ) {
    minCached = Math.max(1, currentChap - PREFETCH_BEHIND);
    maxCached = Math.min(totalChapters, currentChap + PREFETCH_AHEAD);

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type:    'PREFETCH_CHAPTERS',
        current: currentChap,
        total:   totalChapters,
        ahead:   PREFETCH_AHEAD,
        behind:  PREFETCH_BEHIND,
      });
    }
  }
}

/* Console helper — call updateCacheWindow() in DevTools */
window.updateCacheWindow = function(customAhead = PREFETCH_AHEAD, customBehind = PREFETCH_BEHIND) {
  managePrefetch(currentChapter, true);
  return `Cache window: ${Math.max(1, currentChapter - customBehind)} → ${Math.min(totalChapters, currentChapter + customAhead)}`;
};


function saveChapterState() {
  localStorage.setItem('lastChapter', currentChapter);
}

function saveScrollState() {
  localStorage.setItem('scrollPosition', window.scrollY);
}


function determineDesiredInitial() {
  const storedChapter = localStorage.getItem('lastChapter');
  const storedScroll  = localStorage.getItem('scrollPosition');
  const urlParams     = new URLSearchParams(window.location.search);
  const urlChapter    = urlParams.get('chapter');

  let initialChapter = 1;
  let initialScroll  = 0;

  if (urlChapter) {
    initialChapter = parseInt(urlChapter, 10) || 1;
    // Restore scroll only if the URL chapter matches what was last stored
    if (storedChapter && parseInt(storedChapter, 10) === initialChapter) {
      initialScroll = storedScroll ? parseInt(storedScroll, 10) : 0;
    }
  } else if (storedChapter) {
    initialChapter = parseInt(storedChapter, 10) || 1;
    initialScroll  = storedScroll ? parseInt(storedScroll, 10) : 0;
  }

  return { chapter: initialChapter, scroll: initialScroll };
}


function updateUrl() {
  history.replaceState({}, '', `?chapter=${currentChapter}`);
}


function parseChapter(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<p>${l}</p>`)
    .join('');
}

function cleanTitle(line) {
  return line
    .replace(/^chapter\s*\d+\s*[-—–:：.]*/i, '')
    .trim();
}


const titleEl   = () => document.getElementById('chapterTitle');
const contentEl = () => document.getElementById('chapterContent');

function fadeOut() {
  titleEl().classList.add('fading');
  contentEl().classList.add('fading');
}

function fadeIn() {
  // Force a reflow so the transition fires even if set in the same frame
  void contentEl().offsetHeight;
  titleEl().classList.remove('fading');
  contentEl().classList.remove('fading');
}

async function loadDecryptedChapter(n, scrollPos = 0, preloadedText = null) {
  if (loading) return;
  if (n < 1 || n > totalChapters) return;

  loading = true;

  // Disable scroll saving during transition
  if (scrollTimeout) { clearTimeout(scrollTimeout); scrollTimeout = null; }

  currentChapter = n;
  saveChapterState();

  document.getElementById('chapterNumber').textContent       = `Chapter ${n}`;
  document.getElementById('chapterNumberBottom').textContent = `Chapter ${n}`;

  fadeOut();
  updateUrl();

  try {
    const txt = preloadedText || await loadChapter(n, password);

    const lines    = txt.trim().split('\n').filter(l => l.trim().length > 0);
    const rawTitle = lines[0] || `Chapter ${n}`;
    const title    = cleanTitle(rawTitle);
    const body     = lines.slice(1).join('\n\n');

    titleEl().textContent   = title;
    contentEl().innerHTML   = parseChapter(body);
    document.title          = `${n} | ${title}`;

    // Update active button in popup (if already built)
    if (popupInitialized) {
      document.querySelectorAll('#chapterList button').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.chapter) === n);
      });
    }

    managePrefetch(n);

    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPos, behavior: 'auto' });
      fadeIn();
    });

  } catch (_) {
    titleEl().textContent   = 'Error';
    contentEl().innerHTML   = `<p>Chapter ${n} not found or decryption failed.</p>`;
    fadeIn();
  }

  loading = false;
}


function openChapterPopup() {
  const list = document.getElementById('chapterList');

  if (!popupInitialized) {
    const fragment = document.createDocumentFragment();

    for (let ch = 1; ch <= totalChapters; ch++) {
      const btn = document.createElement('button');
      btn.textContent     = `Ch ${ch}`;
      btn.dataset.chapter = ch;
      if (ch === currentChapter) btn.classList.add('active');

      btn.addEventListener('click', () => {
        loadDecryptedChapter(ch);
        closePopup();
      });

      fragment.appendChild(btn);
    }

    list.appendChild(fragment);
    popupInitialized = true;
  }

  document.getElementById('chapterPopup').style.display = 'flex';

  // Scroll the active button into view
  requestAnimationFrame(() => {
    const active = list.querySelector('button.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  });
}

function closePopup() {
  document.getElementById('chapterPopup').style.display = 'none';
}


async function ensurePasswordAndFetch(targetChapter) {
  let storedPassword = localStorage.getItem('novelKey');

  while (true) {
    try {
      if (!storedPassword) {
        storedPassword = prompt('Enter decryption password:');
        if (!storedPassword) throw new Error('Cancelled');
      }

      const txt = await loadChapter(targetChapter, storedPassword);

      password = storedPassword;
      localStorage.setItem('novelKey', password);

      return txt;

    } catch (_) {
      storedPassword = null;
      localStorage.removeItem('novelKey');
      alert('Invalid password. Try again.');
    }
  }
}


document.addEventListener('DOMContentLoaded', async () => {

  /* Icons */
  document.getElementById('navLeftTop').innerHTML    = Icons.left;
  document.getElementById('navRightTop').innerHTML   = Icons.right;
  document.getElementById('navLeftBottom').innerHTML = Icons.left;
  document.getElementById('navRightBottom').innerHTML = Icons.right;

  /* Nav buttons */
  document.getElementById('navLeftTop').onclick    = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navLeftBottom').onclick = () => loadDecryptedChapter(currentChapter - 1);
  document.getElementById('navRightTop').onclick   = () => loadDecryptedChapter(currentChapter + 1);
  document.getElementById('navRightBottom').onclick = () => loadDecryptedChapter(currentChapter + 1);

  /* Chapter picker */
  document.getElementById('chapterNumber').onclick       = openChapterPopup;
  document.getElementById('chapterNumberBottom').onclick = openChapterPopup;

  /* Close popup when clicking the dark overlay (not the content box) */
  document.getElementById('chapterPopup').addEventListener('click', e => {
    if (e.target === document.getElementById('chapterPopup')) closePopup();
  });

  /* Keyboard: Escape closes popup, arrows navigate */
  document.addEventListener('keydown', e => {
    const popup = document.getElementById('chapterPopup');
    if (popup.style.display === 'flex') {
      if (e.key === 'Escape') { closePopup(); return; }
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') loadDecryptedChapter(currentChapter + 1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   loadDecryptedChapter(currentChapter - 1);
  });

  /* Debounced scroll save */
  window.addEventListener('scroll', () => {
    if (loading) return;                         // don't save mid-transition
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveScrollState, 250);
  }, { passive: true });

  /* Resolve starting state */
  const { chapter, scroll } = determineDesiredInitial();

  /* Prompt for password (once), then load */
  const initialText = await ensurePasswordAndFetch(chapter);
  loadDecryptedChapter(chapter, scroll, initialText);

  /* Service Worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] registered', reg.scope))
      .catch(err => console.error('[SW] registration failed', err));
  }
});  ) {

    minCached = Math.max(1, currentChap - behind);
    maxCached = Math.min(totalChapters, currentChap + ahead);

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {

      console.log(`[Prefetch] Triggered for Ch ${currentChap}. Window: ${minCached} to ${maxCached}`);

      navigator.serviceWorker.controller.postMessage({
        type: 'PREFETCH_CHAPTERS',
        current: currentChap,
        total: totalChapters,
        ahead,
        behind
      });

    }
  }
}

window.updateCacheWindow = function(customAhead = 130, customBehind = 20) {

  console.log(`[Console] Forcing cache update: ${customAhead} forward, ${customBehind} backward.`);

  managePrefetch(currentChapter, true, customAhead, customBehind);

  return `Caching commanded for window: ${
    Math.max(1, currentChapter - customBehind)
  } to ${
    Math.min(totalChapters, currentChapter + customAhead)
  }`;
};


function saveChapterState() {
  localStorage.setItem("lastChapter", currentChapter);
}

function saveScrollState() {
  localStorage.setItem("scrollPosition", window.scrollY);
}


function determineDesiredInitial() {

  const storedChapter = localStorage.getItem("lastChapter");
  const storedScroll = localStorage.getItem("scrollPosition");

  const urlParams = new URLSearchParams(window.location.search);
  const urlChapter = urlParams.get("chapter");

  let initialChapter = 1;
  let initialScroll = 0;

  if (urlChapter) {

    initialChapter = parseInt(urlChapter, 10) || 1;

    if (storedChapter && parseInt(storedChapter, 10) === initialChapter) {
      initialScroll = storedScroll ? parseInt(storedScroll, 10) : 0;
    }

  } else if (storedChapter) {

    initialChapter = parseInt(storedChapter, 10) || 1;
    initialScroll = storedScroll ? parseInt(storedScroll, 10) : 0;

  }

  return { chapter: initialChapter, scroll: initialScroll };
}


function updateUrl() {

  const params = new URLSearchParams();
  params.set("chapter", currentChapter);

  history.replaceState({}, "", `?${params}`);
}



function parseChapter(text) {

  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<p>${l}</p>`)
    .join("");

}

function cleanTitle(line) {

  return line
    .replace(/^chapter\s*\d+\s*[-—–:：.]*/i, "")
    .trim();

}


async function loadDecryptedChapter(n, scrollPos = 0, preloadedText = null) {

  if (loading) return;
  if (n < 1 || n > totalChapters) return;

  loading = true;

  currentChapter = n;

  saveChapterState();

  document.getElementById("chapterNumber").textContent = `Chapter ${n}`;
  document.getElementById("chapterNumberBottom").textContent = `Chapter ${n}`;

  document.getElementById("chapterTitle").textContent = "";
  document.getElementById("chapterContent").innerHTML = `<p>Loading...</p>`;

  updateUrl();

  try {

    const txt = preloadedText || await loadChapter(n, password);

    const lines = txt
      .trim()
      .split("\n")
      .filter(l => l.trim().length > 0);

    const rawTitle = lines[0] || `Chapter ${n}`;
    const title = cleanTitle(rawTitle);

    const contentOnly = lines.slice(1).join("\n\n");

    document.getElementById("chapterTitle").textContent = title;
    document.getElementById("chapterContent").innerHTML = parseChapter(contentOnly);

    document.title = `${n} | ${title}`;

    managePrefetch(n);

    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPos, behavior: "auto" });
    });

  }
  catch (e) {

    document.getElementById("chapterTitle").textContent = "Error";

    document.getElementById("chapterContent").innerHTML =
      `<p>Chapter ${n} not found or decryption failed.</p>`;

  }

  loading = false;
}


function openChapterPopup() {

  const list = document.getElementById("chapterList");

  if (!popupInitialized) {

    const fragment = document.createDocumentFragment();

    for (let chapter = 1; chapter <= totalChapters; chapter++) {

      const btn = document.createElement("button");

      btn.textContent = `Ch ${chapter}`;
      btn.dataset.chapter = chapter;

      btn.onclick = () => {

        loadDecryptedChapter(chapter);
        document.getElementById("chapterPopup").style.display = "none";

      };

      fragment.appendChild(btn);

    }

    list.appendChild(fragment);

    popupInitialized = true;
  }

  document.getElementById("chapterPopup").style.display = "flex";
}



async function ensurePasswordAndFetch(targetChapter) {

  let storedPassword = localStorage.getItem("novelKey");

  while (true) {

    try {

      if (!storedPassword) {

        storedPassword = prompt("Enter decryption password:");
        if (!storedPassword) throw new Error("Cancelled");

      }

      const txt = await loadChapter(targetChapter, storedPassword);

      password = storedPassword;

      localStorage.setItem("novelKey", password);

      return txt;

    }
    catch {

      storedPassword = null;

      localStorage.removeItem("novelKey");

      alert("Invalid password. Try again.");

    }

  }
}


document.addEventListener("DOMContentLoaded", async () => {

  document.getElementById("navLeftTop").innerHTML = Icons.left;
  document.getElementById("navRightTop").innerHTML = Icons.right;
  document.getElementById("navLeftBottom").innerHTML = Icons.left;
  document.getElementById("navRightBottom").innerHTML = Icons.right;

  document.getElementById("navLeftTop").onclick =
    () => loadDecryptedChapter(currentChapter - 1);

  document.getElementById("navLeftBottom").onclick =
    () => loadDecryptedChapter(currentChapter - 1);

  document.getElementById("navRightTop").onclick =
    () => loadDecryptedChapter(currentChapter + 1);

  document.getElementById("navRightBottom").onclick =
    () => loadDecryptedChapter(currentChapter + 1);

  document.getElementById("chapterNumber").onclick = openChapterPopup;
  document.getElementById("chapterNumberBottom").onclick = openChapterPopup;


  /* Scroll save (debounced) */

  window.addEventListener("scroll", () => {

    if (scrollTimeout) clearTimeout(scrollTimeout);

    scrollTimeout = setTimeout(saveScrollState, 300);

  });


  /* Determine starting chapter */

  const { chapter, scroll } = determineDesiredInitial();


  /* Verify password */

  const initialText = await ensurePasswordAndFetch(chapter);


  /* Load chapter */

  loadDecryptedChapter(chapter, scroll, initialText);

});
