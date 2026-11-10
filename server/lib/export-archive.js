/**
 * concord-xor-fnv/v1 — the encrypted-archive cipher.
 * Password and salt are mixed as JS code units (charCodeAt), matching the
 * historical server implementation. Plaintext bytes are UTF-8.
 * The browser copy in concord-frontend/lib/export/xor-fnv-archive.ts must
 * stay byte-identical; both sides pin the same vector.
 */

function fnvStep(h, code) {
  const x = (h ^ code) >>> 0;
  return Math.imul(x, 0x01000193) >>> 0;
}

export function deriveKeyStream(password, salt, length) {
  const seed = `${password}::${salt}`;
  const ks = new Uint8Array(length);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) h = fnvStep(h, seed.charCodeAt(i));
  for (let i = 0; i < length; i++) {
    h = fnvStep(h, i & 0xff);
    h ^= h >>> 13;
    ks[i] = h & 0xff;
  }
  return ks;
}

export function archiveChecksum(bytes) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) h = fnvStep(h, bytes[i]);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function xor(bytes, password, salt) {
  const ks = deriveKeyStream(password, salt, bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
  return out;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function encryptArchive(password, payload, salt) {
  const plain = new Uint8Array(Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload ?? {}), "utf8"));
  const cipher = xor(plain, password, salt);
  return {
    algorithm: "concord-xor-fnv/v1",
    salt,
    plainChecksum: archiveChecksum(plain),
    byteLength: cipher.length,
    ciphertextBase64: bytesToBase64(cipher),
    extension: ".enc",
  };
}

export function decryptArchive(password, salt, ciphertextBase64) {
  const cipher = base64ToBytes(ciphertextBase64);
  const plain = xor(cipher, password, salt);
  return {
    checksum: archiveChecksum(plain),
    byteLength: plain.length,
    plaintext: Buffer.from(plain).toString("utf8"),
  };
}
