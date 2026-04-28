/* ================================
   IDB.JS  —  IndexedDB layer
   Stores:
     chapters  keyPath: id  (Number)   → { id, iv, ciphertext }
     assets    keyPath: key (String)   → { key, …payload }
================================ */

const IDB_NAME    = 'novel-reader';
const IDB_VERSION = 1;

let _db = null;

/* ── Open (singleton) ── */

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains('chapters')) {
        db.createObjectStore('chapters', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'key' });
      }
    };

    req.onsuccess = ({ target: { result: db } }) => { _db = db; resolve(db); };
    req.onerror   = ({ target: { error } })       => reject(error);
  });
}


/* ── Primitive helpers ── */

async function idbGet(store, key) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbGetAllKeys(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Delete every record whose key is strictly less than `threshold`.
 * Chapters store uses numeric keys, so IDBKeyRange works directly.
 */
async function idbDeleteBelow(store, threshold) {
  const db    = await openDB();
  const range = IDBKeyRange.upperBound(threshold, true);   // open-upper  →  key < threshold
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(range);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
