/* ================================
   DECRYPT.JS  —  AES-GCM via PBKDF2
   Key is derived once per password+salt pair and cached.
================================ */

let cachedSalt = null;

// Cache: "<password>|<saltB64>" → CryptoKey
// Avoids 100 000-iteration PBKDF2 on every chapter fetch.
const _keyCache = new Map();

async function getSalt() {
  if (cachedSalt) return cachedSalt;
  const manifest = await fetch('manifest.json').then(r => r.json());
  cachedSalt = manifest.salt;
  return cachedSalt;
}

async function getKeyFromPassword(password, saltB64) {
  const cacheKey = password + '|' + saltB64;
  if (_keyCache.has(cacheKey)) return _keyCache.get(cacheKey);

  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const key = await crypto.subtle.importKey(
    'raw',
    derivedBits,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  _keyCache.set(cacheKey, key);
  return key;
}

async function decryptFile(fileJson, password, saltB64) {
  const dec = new TextDecoder();
  const iv         = Uint8Array.from(atob(fileJson.iv),         c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(fileJson.ciphertext), c => c.charCodeAt(0));

  const key       = await getKeyFromPassword(password, saltB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return dec.decode(plaintext);
}

async function loadChapter(chapterNum, password) {
  const salt = await getSalt();
  const file = await fetch(`data/c${chapterNum}.json`).then(r => r.json());
  return decryptFile(file, password, salt);
}
