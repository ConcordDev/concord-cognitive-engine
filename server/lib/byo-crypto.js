// server/lib/byo-crypto.js
//
// AES-GCM-256 wrapping for bring-your-own provider API keys.
//
// The wrapping key is PBKDF2-HMAC-SHA256 over `JWT_SECRET + ":" + userId`,
// with a salt of the first 16 bytes of SHA-256(`byo-salt:${userId}`).
// The salt is per-user, not per-row; the IV is the per-row freshness.
// Two users with the same plaintext therefore produce different ciphertexts,
// and rotating JWT_SECRET invalidates stored keys (users re-paste them).
//
// Ciphertext versions (the blob stored in user_brain_overrides.encrypted_key):
//   v1 (legacy, untagged):  iv(12) || aes-gcm ciphertext
//       PBKDF2 iterations = 10_000. Every row written before the version
//       tag has this shape. The reader must keep using 10_000 for it.
//   v2:                     "BYOv2:" || iv(12) || aes-gcm ciphertext
//       PBKDF2 iterations = 600_000 (SHA-256). New writes only.
//
// v1 rows are left as-is after a successful read. Rewriting them would
// require a database handle on the decrypt path (inference, video-gen,
// connection test), and a failed write there must not risk the stored key.
//
// Production (NODE_ENV=production) refuses to derive a key when JWT_SECRET
// is missing, shorter than 32 characters, a known placeholder, or the
// retired hard-coded pepper. The server calls assertByoCryptoReady() at
// boot and exits; encrypt/decrypt throw the same error if that gate is
// skipped. Dev and test, when JWT_SECRET is unset, use a labelled
// test-only fallback. That fallback is never consulted in production.
//
// Decrypt of a tampered or wrong-user blob returns null. Callers fall
// back to the default brain. A secret-policy failure is not that case:
// it throws, so a misconfigured production process cannot silently
// treat every stored key as undecryptable.
//
// Key material and plaintext API keys are never logged.

import { webcrypto } from "node:crypto";

const V1_ITERATIONS = 10_000;
const V2_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;
const MIN_SECRET_LENGTH = 32;
const V2_MAGIC_TEXT = "BYOv2:";
const V2_MAGIC = Buffer.from(V2_MAGIC_TEXT);

// Dev/test only, and only when JWT_SECRET is unset. The retired pepper
// ("concord-default-byo-pepper-not-for-prod") is intentionally absent
// from this path; it remains in KNOWN_WEAK_SECRETS so production rejects
// it if an operator pastes it into JWT_SECRET.
const TEST_ONLY_FALLBACK_SECRET = "TEST-ONLY-byo-pepper-not-for-production";

// Same placeholder predicate as scripts/verify-prod-env.mjs.
const PLACEHOLDER_RE = /^(your-|change-?me|replace_?me|xxx|placeholder|sk_replace|whsec_replace|price_replace|example)/i;

// Exact secrets that must never wrap keys in production. Lowercased.
// These are denylist entries, not key material: nothing derives from them.
const KNOWN_WEAK_SECRETS = new Set([
  "concord-default-byo-pepper-not-for-prod",
  "test-only-byo-pepper-not-for-production",
  "dev_secret",
  "dev-secret",
  "secret",
  "password",
  "changeme",
  "change-me",
]);

const DERIVED_KEY_CACHE_MAX = 64;
const derivedKeyCache = new Map();

/**
 * Why production must not derive a BYOK wrapping key, or null when the
 * secret is acceptable. Non-production always returns null (dev/test
 * may use the labelled fallback). The reason never includes the secret.
 * @param {string} [secret]
 * @returns {string|null}
 */
export function byoSecretRefusal(secret = process.env.JWT_SECRET) {
  if (process.env.NODE_ENV !== "production") return null;
  if (typeof secret !== "string" || secret.trim() === "") {
    return "JWT_SECRET is not set. Refusing to derive a BYOK wrapping key. Generate one with: openssl rand -hex 64";
  }
  const trimmed = secret.trim();
  if (KNOWN_WEAK_SECRETS.has(trimmed.toLowerCase()) || PLACEHOLDER_RE.test(trimmed)) {
    return "JWT_SECRET is a known default or unedited placeholder. Refusing to derive a BYOK wrapping key. Generate one with: openssl rand -hex 64";
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Refusing to derive a BYOK wrapping key. Generate one with: openssl rand -hex 64`;
  }
  return null;
}

/**
 * Boot and first-use gate. Throws BYO_SECRET_REFUSED in production when
 * JWT_SECRET cannot wrap provider keys. No-op in dev/test.
 */
export function assertByoCryptoReady() {
  const reason = byoSecretRefusal();
  if (!reason) return;
  const err = new Error(`BYOK encryption refused: ${reason}`);
  err.code = "BYO_SECRET_REFUSED";
  throw err;
}

function wrappingSecret() {
  assertByoCryptoReady();
  const set = process.env.JWT_SECRET;
  if (typeof set === "string" && set.length > 0) return set;
  return TEST_ONLY_FALLBACK_SECRET;
}

function touchCache(id, value) {
  derivedKeyCache.delete(id);
  derivedKeyCache.set(id, value);
  while (derivedKeyCache.size > DERIVED_KEY_CACHE_MAX) {
    const oldest = derivedKeyCache.keys().next().value;
    derivedKeyCache.delete(oldest);
  }
}

async function deriveKey(userId, iterations) {
  const secret = wrappingSecret();
  const enc = new TextEncoder();
  // Cache id is a digest of the secret, not the secret itself.
  const fpBuf = await webcrypto.subtle.digest("SHA-256", enc.encode(secret));
  const cacheId = `${iterations}\0${userId}\0${Buffer.from(fpBuf).toString("hex")}`;
  const hit = derivedKeyCache.get(cacheId);
  if (hit) {
    touchCache(cacheId, hit);
    return hit;
  }

  const pw = secret + ":" + userId;
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    enc.encode(pw),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const saltSrc = await webcrypto.subtle.digest(
    "SHA-256",
    enc.encode(`byo-salt:${userId}`),
  );
  const salt = new Uint8Array(saltSrc).slice(0, SALT_LENGTH_BYTES);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
  touchCache(cacheId, key);
  return key;
}

function hasMagic(u8) {
  if (u8.length < V2_MAGIC.length) return false;
  for (let i = 0; i < V2_MAGIC.length; i++) {
    if (u8[i] !== V2_MAGIC[i]) return false;
  }
  return true;
}

function toU8(encrypted) {
  if (encrypted instanceof Uint8Array) return encrypted;
  return new Uint8Array(encrypted);
}

/**
 * @param {Buffer|Uint8Array|null} encrypted
 * @returns {1|2|null} 1 = legacy untagged blob, 2 = BYOv2 framing
 */
export function ciphertextVersion(encrypted) {
  if (!encrypted) return null;
  try {
    return hasMagic(toU8(encrypted)) ? 2 : 1;
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext API key for a given user.
 * New rows are always version 2 (600_000 PBKDF2 iterations).
 * @param {string} userId
 * @param {string} plaintextKey
 * @returns {Promise<Buffer>}
 */
export async function encryptKey(userId, plaintextKey) {
  assertByoCryptoReady();
  if (!userId || !plaintextKey) throw new Error("missing inputs");
  const key = await deriveKey(userId, V2_ITERATIONS);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintextKey),
  ));
  const out = new Uint8Array(V2_MAGIC.length + iv.length + cipher.length);
  out.set(V2_MAGIC, 0);
  out.set(iv, V2_MAGIC.length);
  out.set(cipher, V2_MAGIC.length + iv.length);
  return Buffer.from(out);
}

/**
 * Decrypt an encrypted API key for a given user.
 * Returns null on tampering, a wrong user, or a truncated blob.
 * Throws BYO_SECRET_REFUSED in production when JWT_SECRET is unfit
 * (that error is not swallowed: it is a deployment failure).
 * @param {string} userId
 * @param {Buffer|Uint8Array} encrypted
 * @returns {Promise<string|null>}
 */
export async function decryptKey(userId, encrypted) {
  assertByoCryptoReady();
  if (!userId || !encrypted) return null;
  let u8;
  try {
    u8 = toU8(encrypted);
  } catch {
    return null;
  }
  const versioned = hasMagic(u8);
  const header = versioned ? V2_MAGIC.length : 0;
  if (u8.length <= header + IV_LENGTH_BYTES) return null;
  try {
    const key = await deriveKey(userId, versioned ? V2_ITERATIONS : V1_ITERATIONS);
    const iv = u8.slice(header, header + IV_LENGTH_BYTES);
    const cipher = u8.slice(header + IV_LENGTH_BYTES);
    const plainBuf = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    if (err && err.code === "BYO_SECRET_REFUSED") throw err;
    return null;
  }
}

/**
 * Produce a non-reversible preview suitable for displaying to the user.
 * The frontend never receives the full key after save — only this preview.
 */
export function previewOf(plaintextKey) {
  if (!plaintextKey || typeof plaintextKey !== "string") return "***";
  const s = plaintextKey.trim();
  if (s.length <= 8) return "•••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export const BYO_CRYPTO_CONSTANTS = Object.freeze({
  V1_ITERATIONS,
  V2_ITERATIONS,
  // Iterations used for newly written rows.
  ITERATIONS: V2_ITERATIONS,
  KEY_LENGTH_BITS,
  IV_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
  MIN_SECRET_LENGTH,
  V2_MAGIC: V2_MAGIC_TEXT,
});
