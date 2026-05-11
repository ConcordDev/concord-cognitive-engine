// server/lib/byo-crypto.js
//
// Sprint 10 — encryption helpers for BYO API keys.
//
// AES-GCM 256 with per-user wrapping. The wrapping key is derived
// from `JWT_SECRET || a fallback constant` + the user_id via PBKDF2
// (10k iterations). This means:
//   - Each user has an isolated keyspace
//   - Rotating JWT_SECRET invalidates all stored keys (acceptable —
//     users re-paste from their provider dashboards)
//   - Two users with the same plaintext key produce different ciphertexts
//
// We deliberately use Node's built-in `crypto.webcrypto` (no native
// build deps). On any decrypt failure (tampering, bad key, corrupted
// row) we return null and the caller falls back to the default Ollama
// brain — never crash, never leak which side of the cipher failed.

import { webcrypto } from "node:crypto";

const ITERATIONS = 10_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;

async function deriveKey(userId) {
  const pw = (process.env.JWT_SECRET || "concord-default-byo-pepper-not-for-prod") + ":" + userId;
  const enc = new TextEncoder();
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    enc.encode(pw),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  // Salt is derived deterministically from userId so the same user
  // gets the same wrapping key across server restarts. NOT a per-row
  // salt — the per-row freshness comes from the IV.
  const saltSrc = await webcrypto.subtle.digest(
    "SHA-256",
    enc.encode(`byo-salt:${userId}`),
  );
  const salt = new Uint8Array(saltSrc).slice(0, SALT_LENGTH_BYTES);
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext API key for a given user.
 * @param {string} userId
 * @param {string} plaintextKey
 * @returns {Promise<Buffer>}  iv || ciphertext (binary), suitable for SQLite BLOB column
 */
export async function encryptKey(userId, plaintextKey) {
  if (!userId || !plaintextKey) throw new Error("missing inputs");
  const key = await deriveKey(userId);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const enc = new TextEncoder();
  const cipherBuf = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintextKey),
  );
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return Buffer.from(out);
}

/**
 * Decrypt an encrypted API key for a given user.
 * Never throws — returns null on any failure (tampering, missing JWT_SECRET,
 * mismatched user_id). The caller falls back to the default brain.
 * @param {string} userId
 * @param {Buffer|Uint8Array} encrypted
 * @returns {Promise<string|null>}
 */
export async function decryptKey(userId, encrypted) {
  if (!userId || !encrypted || encrypted.length <= IV_LENGTH_BYTES) return null;
  try {
    const key = await deriveKey(userId);
    const u8 = encrypted instanceof Uint8Array ? encrypted : new Uint8Array(encrypted);
    const iv = u8.slice(0, IV_LENGTH_BYTES);
    const cipher = u8.slice(IV_LENGTH_BYTES);
    const plainBuf = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}

/**
 * Produce a non-reversible preview suitable for displaying to the user.
 *   "sk-ant-…" + last 4 chars + " (Anthropic key)".
 * The frontend never receives the full key after save — only this
 * preview.
 */
export function previewOf(plaintextKey) {
  if (!plaintextKey || typeof plaintextKey !== "string") return "***";
  const s = plaintextKey.trim();
  if (s.length <= 8) return "•••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export const BYO_CRYPTO_CONSTANTS = Object.freeze({
  ITERATIONS, KEY_LENGTH_BITS, IV_LENGTH_BYTES, SALT_LENGTH_BYTES,
});
