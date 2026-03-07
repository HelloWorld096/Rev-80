const Icons = {
  left: `<svg viewBox="0 0 24 24" width="24" height="24"><polyline points="15 18 9 12 15 6" stroke="black" stroke-width="2" fill="none"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="24" height="24"><polyline points="9 6 15 12 9 18" stroke="black" stroke-width="2" fill="none"/></svg>`
};


/* ================================
   GLOBAL STATE
================================ */

const totalChapters = 2334;

let currentChapter = 1;
let password = null;

let popupInitialized = false;
let scrollTimeout = null;
let loading = false;


/* ================================
   PREFETCH MANAGEMENT
================================ */

let minCached = Infinity;
let maxCached = 0;

function managePrefetch(currentChap, force = false, ahead = 30, behind = 5) {

  const remainingForward = maxCached - currentChap;

  if (
    force ||
    maxCached === 0 ||
    remainingForward < 10 ||
    currentChap <= minCached
  ) {

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


/* ================================
   CONSOLE CONTROL
================================ */

window.updateCacheWindow = function(customAhead = 130, customBehind = 20) {

  console.log(`[Console] Forcing cache update: ${customAhead} forward, ${customBehind} backward.`);

  managePrefetch(currentChapter, true, customAhead, customBehind);

  return `Caching commanded for window: ${
    Math.max(1, currentChapter - customBehind)
  } to ${
    Math.min(totalChapters, currentChapter + customAhead)
  }`;
};


/* ================================
   STORAGE
================================ */

function saveChapterState() {
  localStorage.setItem("lastChapter", currentChapter);
}

function saveScrollState() {
  localStorage.setItem("scrollPosition", window.scrollY);
}


/* ================================
   INITIAL CHAPTER RESOLUTION
================================ */

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


/* ================================
   URL MANAGEMENT
================================ */

function updateUrl() {

  const params = new URLSearchParams();
  params.set("chapter", currentChapter);

  history.replaceState({}, "", `?${params}`);
}


/* ================================
   TEXT PARSING
================================ */

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


/* ================================
   LOAD CHAPTER
================================ */

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


/* ================================
   CHAPTER POPUP
================================ */

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


/* ================================
   PASSWORD MANAGEMENT
================================ */

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


/* ================================
   INITIALIZATION
================================ */

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
