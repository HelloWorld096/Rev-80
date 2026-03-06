    const Icons = {
      left: `<svg viewBox="0 0 24 24" width="24" height="24"><polyline points="15 18 9 12 15 6" stroke="black" stroke-width="2" fill="none"/></svg>`,
      right: `<svg viewBox="0 0 24 24" width="24" height="24"><polyline points="9 6 15 12 9 18" stroke="black" stroke-width="2" fill="none"/></svg>`
    };

    const totalChapters = 2334;
    let currentChapter = 1;
    let password = null;

    function saveState() {
      localStorage.setItem('lastChapter', currentChapter);
      localStorage.setItem('scrollPosition', window.scrollY);
    }

    function determineDesiredInitial() {
      const storedChapter = localStorage.getItem('lastChapter');
      const storedScroll = localStorage.getItem('scrollPosition');
      const urlParams = new URLSearchParams(window.location.search);
      const urlChapter = urlParams.get('chapter');

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
      const urlParams = new URLSearchParams();
      urlParams.set('chapter', currentChapter);
      history.replaceState({}, '', `?${urlParams}`);
    }

    function parseChapter(text) {
      return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `<p>${line}</p>`)
        .join('');
    }

    function cleanTitle(line) {
      return line.replace(/^chapter\s*\d+\s*[-—–:：.]*\s*/i, '').trim();
    }

    async function loadDecryptedChapter(n, scrollPos = 0) {
      if (n < 1 || n > totalChapters) return;

      currentChapter = n;
      saveState();

      document.getElementById('chapterNumber').textContent = `Chapter ${n}`;
      document.getElementById('chapterNumberBottom').textContent = `Chapter ${n}`;
      document.getElementById('chapterTitle').textContent = '';
      document.getElementById('chapterContent').innerHTML = `<p>Loading...</p>`;

      updateUrl();

      try {
        const txt = await loadChapter(n, password);
        const lines = txt.trim().split('\n').filter(l => l.trim().length > 0);
        const rawTitle = lines[0] || `Chapter ${n}`;
        const title = cleanTitle(rawTitle);
        const contentOnly = lines.slice(1).join('\n\n');

        document.getElementById('chapterTitle').textContent = title;
        document.getElementById('chapterContent').innerHTML = parseChapter(contentOnly);

        document.title = `${n} | ${title}`;

        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollPos, behavior: 'auto' });
        });
      } catch (e) {
        document.getElementById('chapterTitle').textContent = 'Error';
        document.getElementById('chapterContent').innerHTML =
          `<p>Chapter ${n} not found or decryption failed (${e.message}).</p>`;
        document.title = `Error loading chapter ${n}`;
      }
    }

    function openChapterPopup() {
      const chapterListDiv = document.getElementById('chapterList');
      chapterListDiv.innerHTML = '';
      let activeBtn = null;

      for (let chapter = 1; chapter <= totalChapters; chapter++) {
        const btn = document.createElement('button');
        btn.textContent = `Ch ${chapter}`;
        if (chapter === currentChapter) {
          btn.classList.add('active');
          activeBtn = btn;
        }
        btn.onclick = () => {
          loadDecryptedChapter(chapter);
          document.getElementById('chapterPopup').style.display = 'none';
        };
        chapterListDiv.appendChild(btn);
      }

      document.getElementById('chapterPopup').style.display = 'flex';
      if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function ensurePassword() {
      let storedPassword = localStorage.getItem('novelKey');
      while (true) {
        try {
          if (!storedPassword) {
            storedPassword = prompt("Enter decryption password:");
          }
          // test with chapter 1
          await loadChapter(1, storedPassword);
          password = storedPassword;
          localStorage.setItem('novelKey', password);
          return;
        } catch {
          storedPassword = null;
          localStorage.removeItem('novelKey');
          alert("Invalid password. Please try again.");
        }
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('navLeftTop').innerHTML = Icons.left;
      document.getElementById('navRightTop').innerHTML = Icons.right;
      document.getElementById('navLeftBottom').innerHTML = Icons.left;
      document.getElementById('navRightBottom').innerHTML = Icons.right;

      document.getElementById("navLeftTop").onclick = () => loadDecryptedChapter(currentChapter - 1);
      document.getElementById("navLeftBottom").onclick = () => loadDecryptedChapter(currentChapter - 1);
      document.getElementById("navRightTop").onclick = () => loadDecryptedChapter(currentChapter + 1);
      document.getElementById("navRightBottom").onclick = () => loadDecryptedChapter(currentChapter + 1);

      document.getElementById('chapterNumber').onclick = openChapterPopup;
      document.getElementById('chapterNumberBottom').onclick = openChapterPopup;
      document.getElementById('chapterPopup').addEventListener('click', (e) => {
        if (e.target.id === 'chapterPopup') {
          e.currentTarget.style.display = 'none';
        }
      });

      window.addEventListener('scroll', saveState);
      window.addEventListener('beforeunload', saveState);

      const { chapter, scroll } = determineDesiredInitial();

      await ensurePassword();
      loadDecryptedChapter(chapter, scroll);
    });
