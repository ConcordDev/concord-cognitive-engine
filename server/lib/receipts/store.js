// server/lib/receipts/store.js
//
// Durable store + read-by-id for signed receipts (migration 514).
//
// issueStoredReceipt(): put a receipt id INSIDE the body, sign it (so the id
// is covered by the signature), then persist the exact signed object. The
// digest cannot live in the signed body (it is the hash of those bytes), so
// it is a separate unique column; GET accepts either the id or the digest.
//
// Store failure never throws out of issueStoredReceipt: the caller still has
// the signed receipt and gets { saved:false, saveError }. An unsigned receipt
// (no signing key) is never stored.

import crypto from "node:crypto";
import { attestReceipt, verifyAttestation } from "./attest.js";

export const RECEIPT_ID_PREFIX = "rcpt_";
const ID_RE = /^rcpt_[A-Za-z0-9-]{8,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export function newReceiptId() {
  return `${RECEIPT_ID_PREFIX}${crypto.randomUUID()}`;
}

/** "id" | "digest" | null for an illegal / overlong / traversal-ish string. */
export function classifyReceiptKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 80) return null;
  if (DIGEST_RE.test(key)) return "digest";
  if (ID_RE.test(key)) return "id";
  return null;
}

function resolveDb(db) {
  return db || globalThis._concordSTATE?.db || null;
}

/**
 * Persist an already-signed receipt. Idempotent on the digest.
 * @returns {{ ok:true, receiptId:string|null, digest:string, created:boolean } | { ok:false, reason:string }}
 */
export function storeReceipt(db, receipt) {
  const handle = resolveDb(db);
  if (!handle) return { ok: false, reason: "no_database" };
  try {
    const block = receipt && receipt.signature;
    if (!block || typeof block.signature !== "string" || !block.signature) return { ok: false, reason: "unsigned_receipt" };
    const verdict = verifyAttestation(receipt);
    if (!verdict.valid) return { ok: false, reason: `invalid_receipt:${verdict.reason}` };
    const digest = block.digest;
    const receiptId = typeof receipt.receiptId === "string" && ID_RE.test(receipt.receiptId) ? receipt.receiptId : null;
    const issuer = receipt.issuer && typeof receipt.issuer === "object" ? JSON.stringify(receipt.issuer) : null;
    const info = handle.prepare(
      `INSERT OR IGNORE INTO receipt_store (receipt_id, digest, schema, key_id, issuer, issued_at, receipt_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(receiptId, digest, verdict.schema, block.keyId || null, issuer, receipt.issuedAt || null, JSON.stringify(receipt));
    if (info.changes === 0) {
      const row = handle.prepare("SELECT receipt_id FROM receipt_store WHERE digest = ?").get(digest);
      if (!row) return { ok: false, reason: "store_conflict" };
      return { ok: true, receiptId: row.receipt_id || null, digest, created: false };
    }
    return { ok: true, receiptId, digest, created: true };
  } catch (e) {
    return { ok: false, reason: `store_failed:${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The stored receipt (parsed, exactly as signed) for an id or digest, or null. */
export function getStoredReceipt(db, key) {
  const kind = classifyReceiptKey(key);
  if (!kind) return null;
  const handle = resolveDb(db);
  if (!handle) return null;
  const row = handle.prepare(
    `SELECT receipt_json FROM receipt_store WHERE ${kind === "digest" ? "digest" : "receipt_id"} = ?`,
  ).get(key);
  if (!row) return null;
  try { return JSON.parse(row.receipt_json); } catch { return null; }
}

/**
 * Sign `receipt` with a fresh receiptId inside the signed body, then store it.
 * Any previous signature / issuedAt / receiptId on the input is replaced.
 * @param {object} receipt receipt body or an already-signed receipt
 * @param {{ db?: object, now?: () => string, store?: Function }} [opts] `store` is a test seam
 * @returns {{ receipt: object, saved: boolean, receiptId?: string, receiptUrl?: string, saveError?: string }}
 */
export function issueStoredReceipt(receipt, opts = {}) {
  const { signature: _s, issuedAt: _i, receiptId: _r, ...body } = receipt || {};
  const receiptId = newReceiptId();
  const signed = attestReceipt({ ...body, receiptId }, opts.now ? { now: opts.now } : {});
  let outcome;
  try {
    outcome = (opts.store || storeReceipt)(opts.db, signed);
  } catch (e) {
    outcome = { ok: false, reason: `store_failed:${e instanceof Error ? e.message : String(e)}` };
  }
  if (outcome && outcome.ok) {
    return { receipt: signed, saved: true, receiptId: outcome.receiptId || receiptId, receiptUrl: `/api/receipts/${outcome.receiptId || receiptId}` };
  }
  return { receipt: signed, saved: false, saveError: (outcome && outcome.reason) || "store_failed" };
}
