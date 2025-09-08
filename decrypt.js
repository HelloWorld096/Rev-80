async function getKeyFromPassword(password, saltB64) {
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return crypto.subtle.importKey(
    "raw",
    derivedBits,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

async function decryptFile(fileJson, password, saltB64) {
  const dec = new TextDecoder();

  const iv = Uint8Array.from(atob(fileJson.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(fileJson.ciphertext), c => c.charCodeAt(0));

  const key = await getKeyFromPassword(password, saltB64);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );

  return dec.decode(plaintext);
}

async function loadChapter(chapterNum, password) {
  const manifest = await fetch("manifest.json").then(r => r.json());
  const salt = manifest.salt;

  const file = await fetch(`data/c${chapterNum}.json`).then(r => r.json());

  return decryptFile(file, password, salt);
}
