// Concord receipt attestation.
//
// A receipt body is any JSON object a ConKay job already returns (an analysis
// receipt, a loop receipt, a showcase snapshot, a validation report). This
// module adds:
//
//   issuedAt   ISO-8601 timestamp, part of the signed body
//   signature  { alg, canon, digest, keyId, signature, reason }
//
// The signature block is excluded from the canonical bytes. Those bytes are
// sorted-key JSON (UTF-8, no insignificant whitespace) of the body after a
// JSON round-trip, so they match what a client holds after parse(stringify()).
// `digest` is SHA-256 of those bytes. `signature` is an Ed25519 signature
// over the same bytes, standard base64. `keyId` is the first 16 hex chars of
// SHA-256 of the raw 32-byte public key.
//
// The private key comes from CONCORD_RECEIPT_SIGNING_KEY (PEM, PKCS#8) or
// CONCORD_RECEIPT_SIGNING_KEY_PATH. It is read once, on first use. If it is
// missing or unusable, the receipt is still returned with signature: null and
// a reason. This module never generates a throwaway key.

import crypto from "node:crypto";
import fs from "node:fs";

export const CANON = "sorted-json-v1";
export const ALG = "Ed25519";

/** SPKI DER prefix for a raw 32-byte Ed25519 public key (OID 1.3.101.112). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const UNSIGNED_MISSING = "no_signing_key";
const UNSIGNED_INVALID = "signing_key_invalid";

/** @type {undefined | null | { privateKey: crypto.KeyObject, keyId: string, publicKeyB64: string, error?: undefined } | { error: string }} */
let cached = undefined;
let warnedInvalid = false;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

/**
 * Stable canonical JSON of `value`. Object keys are sorted; arrays keep
 * order. A JSON round-trip first drops `undefined` and converts Dates the
 * same way `JSON.stringify` does, so the digest matches a receipt that has
 * been parsed from text.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return canonicalize(JSON.parse(JSON.stringify(value)));
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function rawPublicFromKey(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

export function keyIdForRawPublic(raw) {
  return sha256Hex(raw).slice(0, 16);
}

export function publicKeyFromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 32) {
    throw new Error("ed25519 public key must be 32 bytes");
  }
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function normalizePem(text) {
  const trimmed = String(text).trim();
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

function readPem() {
  const inline = process.env.CONCORD_RECEIPT_SIGNING_KEY;
  if (inline && inline.trim()) return normalizePem(inline);
  const file = process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH;
  if (file && file.trim()) {
    try {
      return fs.readFileSync(file.trim(), "utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The process signing key, or null when none is configured.
 * An unreadable key is `{ error: "signing_key_invalid" }`.
 */
export function loadSigningKey() {
  if (cached !== undefined) return cached;
  const pem = readPem();
  if (!pem) {
    cached = null;
    return cached;
  }
  try {
    const privateKey = crypto.createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("key is not Ed25519");
    }
    const raw = rawPublicFromKey(crypto.createPublicKey(privateKey));
    cached = { privateKey, keyId: keyIdForRawPublic(raw), publicKeyB64: raw.toString("base64") };
  } catch (err) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      console.warn(`[receipts] signing key was not usable (${err instanceof Error ? err.message : "invalid"}). Receipts will be unsigned.`);
    }
    cached = { error: UNSIGNED_INVALID };
  }
  return cached;
}

/** Test hook. The key is otherwise cached for the life of the process. */
export function resetSigningKeyCache() {
  cached = undefined;
  warnedInvalid = false;
}

/** keyId → base64 raw public key. Never includes private material. */
export function publishedPublicKeys() {
  /** @type {Record<string, string>} */
  const keys = {};
  const extra = process.env.CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS;
  if (extra && extra.trim()) {
    try {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, b64] of Object.entries(parsed)) {
          if (typeof b64 !== "string") continue;
          const raw = Buffer.from(b64, "base64");
          if (raw.length === 32) keys[id] = raw.toString("base64");
        }
      }
    } catch (err) {
      console.warn(`[receipts] CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS was not JSON (${err instanceof Error ? err.message : "invalid"}).`);
    }
  }
  const key = loadSigningKey();
  if (key && key.publicKeyB64 && key.keyId) keys[key.keyId] = key.publicKeyB64;
  return keys;
}

export function publicKeyDocument() {
  return { alg: ALG, canon: CANON, keys: publishedPublicKeys() };
}

/**
 * Copy `receipt` and attach issuedAt + a signature block.
 * The input object is not mutated.
 * @param {Record<string, unknown>} receipt
 * @param {{ now?: () => string }} [opts]
 */
export function attestReceipt(receipt, opts = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new TypeError("attestReceipt: receipt must be an object");
  }
  const { signature: _previous, issuedAt: _previousIssued, ...rest } = receipt;
  const issuedAt = typeof opts.now === "function" ? opts.now() : new Date().toISOString();
  const body = { ...rest, issuedAt };
  const canonical = canonicalJson(body);
  const digest = sha256Hex(canonical);
  const key = loadSigningKey();
  const block = {
    alg: ALG,
    canon: CANON,
    digest,
    keyId: key && key.keyId ? key.keyId : null,
    signature: null,
    reason: key && key.keyId ? null : (key && key.error) || UNSIGNED_MISSING,
  };
  if (key && key.privateKey) {
    block.signature = crypto.sign(null, Buffer.from(canonical, "utf8"), key.privateKey).toString("base64");
    block.reason = null;
  }
  return { ...body, signature: block };
}

/**
 * Attest nested receipt slots, then the report itself, so the outer signature
 * covers the inner ones. Plain objects only; anything else is returned as-is.
 * @param {Record<string, unknown>} report
 */
export function attestReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const next = { ...report };
  if (next.receipt && typeof next.receipt === "object" && !Array.isArray(next.receipt)) {
    next.receipt = attestReceipt(next.receipt);
  }
  if (next.analysisReceipt && typeof next.analysisReceipt === "object" && !Array.isArray(next.analysisReceipt)) {
    next.analysisReceipt = attestReceipt(next.analysisReceipt);
  }
  if (Array.isArray(next.receipts)) {
    next.receipts = next.receipts.map((item) => (
      item && typeof item === "object" && !Array.isArray(item) ? attestReceipt(item) : item
    ));
  }
  return attestReceipt(next);
}

/**
 * Check a receipt against `keys` (keyId → base64 raw public key).
 * Defaults to the keys this process publishes.
 * @param {unknown} receipt
 * @param {Record<string, string> | null} [keys]
 * @returns {{ valid: boolean, reason: string | null, keyId?: string, digest?: string }}
 */
export function verifyAttestation(receipt, keys = null) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, reason: "malformed" };
  }
  const block = receipt.signature;
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return { valid: false, reason: "missing_signature" };
  }
  if (block.signature == null) {
    return { valid: false, reason: typeof block.reason === "string" && block.reason ? block.reason : "unsigned" };
  }
  if (block.canon && block.canon !== CANON) return { valid: false, reason: "unsupported_canon" };
  if (block.alg && block.alg !== ALG) return { valid: false, reason: "unsupported_alg" };
  const { signature: _block, ...body } = receipt;
  let canonical;
  try {
    canonical = canonicalJson(body);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const digest = sha256Hex(canonical);
  if (typeof block.digest !== "string" || digest !== block.digest) {
    return { valid: false, reason: "digest_mismatch" };
  }
  const map = keys || publishedPublicKeys();
  const keyId = typeof block.keyId === "string" ? block.keyId : "";
  const pubB64 = map[keyId];
  if (!pubB64) return { valid: false, reason: "unknown_key" };
  try {
    const raw = Buffer.from(pubB64, "base64");
    const pub = publicKeyFromRaw(raw);
    const sig = Buffer.from(block.signature, "base64");
    const ok = crypto.verify(null, Buffer.from(canonical, "utf8"), pub, sig);
    if (!ok) return { valid: false, reason: "bad_signature" };
  } catch {
    return { valid: false, reason: "bad_signature" };
  }
  return { valid: true, reason: null, keyId, digest };
}
