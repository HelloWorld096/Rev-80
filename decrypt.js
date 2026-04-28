/* ================================
   DECRYPT.JS
   Key derived once per password+salt and cached in memory.
   Chapter JSON and the manifest salt are cached in IndexedDB
   so they survive page reloads without a network round-trip.
================================ */

let _cachedSalt = null;
const _keyCache = new Map();   // "<password>|<saltB64>" → CryptoKey


/* ================================
   SALT  —  IDB-backed
================================ */

async function getSalt() {
  // 1. In-memory hit
  if (_cachedSalt) return _cachedSalt;

  // 2. IDB hit
  const stored = await idbGet('assets', 'manifest-salt');
  if (stored) {
    _cachedSalt = stored.value;
    return _cachedSalt;
  }

  // 3. Network fetch (manifest.json is in the SW app-shell → available offline after first load)
  const manifest = await fetch('manifest.json').then(r => r.json());
  _cachedSalt = manifest.salt;

  // Persist so subsequent cold-starts skip the fetch
  idbPut('assets', { key: 'manifest-salt', value: _cachedSalt }).catch(() => {});

  return _cachedSalt;
}


/* ================================
   KEY DERIVATION  —  in-memory cache
================================ */

async function getKey(password, saltB64) {
  const cacheKey = `${password}|${saltB64}`;
  if (_keyCache.has(cacheKey)) return _keyCache.get(cacheKey);

  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );

  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const key = await crypto.subtle.importKey(
    'raw', bits, { name: 'AES-GCM' }, false, ['decrypt']
  );

  _keyCache.set(cacheKey, key);
  return key;
}


/* ================================
   DECRYPTION
================================ */

async function decryptFile(fileJson, password, saltB64) {
  const dec        = new TextDecoder();
  const iv         = Uint8Array.from(atob(fileJson.iv),         c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(fileJson.ciphertext), c => c.charCodeAt(0));
  const key        = await getKey(password, saltB64);
  const plain      = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return dec.decode(plain);
}


/* ================================
   LOAD CHAPTER  —  IDB-first
================================ */

async function loadChapter(chapterNum, password) {
  const salt = await getSalt();

  // 1. Try IDB (covers offline + repeat visits)
  let file = await idbGet('chapters', chapterNum);

  if (!file) {
    // 2. Network fetch — store for future offline use (fire-and-forget write)
    const res = await fetch(`data/c${chapterNum}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching chapter ${chapterNum}`);
    const fetched = await res.json();
    file = { ...fetched, id: chapterNum };
    idbPut('chapters', file).catch(() => {});   // non-blocking
  }

  return decryptFile(file, password, salt);
}
