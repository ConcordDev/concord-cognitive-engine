#!/usr/bin/env node
// Offline verifier for Concord signed receipts (node:crypto only, no repo imports).
//
//   node scripts/verify-receipt.mjs <receipt.json> <keys.json | https://…/concord-receipt-keys.json>
//
// Prints "VALID" or "INVALID <reason>" and exits 0 / 1 (2 on usage or load errors).
// Algorithm: drop the top-level `signature` field, canonicalize the rest as
// sorted-json-v1 (object keys sorted, arrays in order, no whitespace), SHA-256 it
// and compare with signature.digest, then Ed25519-verify signature.signature
// (base64) over the same bytes with the public key for signature.keyId.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
}

/** @returns {{ valid: boolean, reason: string | null, keyId?: string, schema?: string }} */
export function verifyReceiptOffline(receipt, keysDoc) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { valid: false, reason: "malformed" };
  const block = receipt.signature;
  if (!block || typeof block !== "object" || Array.isArray(block)) return { valid: false, reason: "missing_signature" };
  if (block.signature == null) return { valid: false, reason: block.reason || "unsigned" };
  if (block.canon && block.canon !== "sorted-json-v1") return { valid: false, reason: "unsupported_canon" };
  if (block.alg && block.alg !== "Ed25519") return { valid: false, reason: "unsupported_alg" };
  const { signature: _s, ...body } = receipt;
  const canonical = canonicalize(JSON.parse(JSON.stringify(body)));
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");
  if (digest !== block.digest) return { valid: false, reason: "digest_mismatch" };
  const keys = keysDoc && typeof keysDoc.keys === "object" && keysDoc.keys ? keysDoc.keys : keysDoc || {};
  const keyId = typeof block.keyId === "string" ? block.keyId : "";
  const b64 = Object.prototype.hasOwnProperty.call(keys, keyId) ? keys[keyId] : null;
  if (typeof b64 !== "string") return { valid: false, reason: "unknown_key", keyId };
  try {
    const raw = Buffer.from(b64, "base64");
    if (raw.length !== 32) return { valid: false, reason: "bad_key", keyId };
    const pub = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    const ok = crypto.verify(null, Buffer.from(canonical, "utf8"), pub, Buffer.from(block.signature, "base64"));
    if (!ok) return { valid: false, reason: "bad_signature", keyId };
  } catch {
    return { valid: false, reason: "bad_signature", keyId };
  }
  return { valid: true, reason: null, keyId, schema: typeof receipt.receiptSchema === "string" ? receipt.receiptSchema : "v1" };
}

async function loadKeys(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`keys fetch failed: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

async function main(argv) {
  if (argv.length < 2) {
    console.error("usage: verify-receipt.mjs <receipt.json> <keys.json|url>");
    return 2;
  }
  let receipt, keys;
  try {
    receipt = JSON.parse(readFileSync(argv[0], "utf8"));
    keys = await loadKeys(argv[1]);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const r = verifyReceiptOffline(receipt, keys);
  console.log(r.valid ? `VALID (keyId ${r.keyId}, schema ${r.schema})` : `INVALID ${r.reason}`);
  return r.valid ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
