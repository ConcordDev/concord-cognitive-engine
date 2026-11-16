// Public receipt verification.
//
// GET  /.well-known/concord-receipt-keys.json
//      keyId → base64 raw Ed25519 public key. No private material.
// POST /api/receipts/verify
//      { receipt } or the receipt object itself → { valid, reason }.
//      Unauthenticated. CSRF-exempt on this exact path only
//      (middleware/csrf.js — not a prefix). The caller supplies the
//      rate-limit middleware. Verification does not write anything.

import express from "express";
import { ensureSigningKey, publicKeyDocument, verifyAttestation } from "../lib/receipts/attest.js";
import { renderCalcSheetHtml } from "../lib/receipts/calc-sheet.js";
import { classifyReceiptKey, getStoredReceipt } from "../lib/receipts/store.js";

const MAX_RECEIPT_CHARS = 1_500_000;

export default function createReceiptRouter({ readLimit, verifyLimit, db } = {}) {
  const router = express.Router();
  const read = readLimit || ((_req, _res, next) => next());
  const verify = verifyLimit || ((_req, _res, next) => next());

  const serveKeys = async (_req, res) => {
    try {
      await ensureSigningKey();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(publicKeyDocument());
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  router.get("/.well-known/concord-receipt-keys.json", read, serveKeys);
  // AUTH: public — same document as the .well-known path, for clients that only know /api/receipts.
  // Registered before /:id so "keys" is never read as a receipt id.
  router.get("/api/receipts/keys", read, serveKeys);

  // AUTH: public — receipt verification is unauthenticated by design (CSRF-exempt exact path).
  router.post("/api/receipts/verify", verify, (req, res) => {
    const body = req.body;
    const receipt = body && typeof body === "object" && !Array.isArray(body) && body.receipt && typeof body.receipt === "object" && !Array.isArray(body.receipt)
      ? body.receipt
      : body;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      return res.status(400).json({ valid: false, reason: "malformed" });
    }
    let encoded;
    try {
      encoded = JSON.stringify(receipt);
    } catch {
      return res.status(400).json({ valid: false, reason: "malformed" });
    }
    if (encoded.length > MAX_RECEIPT_CHARS) {
      return res.status(413).json({ valid: false, reason: "too_large" });
    }
    res.json(verifyAttestation(receipt));
  });

  // Same discipline as verify (GB-1534). The receipt is verified FIRST and
  // the verdict is printed at the top of the sheet; an edited receipt
  // renders with INVALID at the top, never silently. The handler writes
  // nothing. CSRF-exempt on this exact path only (see server.js gates,
  // which name /api/receipts/sheet beside /verify).
  // AUTH: public — unauthenticated receipt calc-sheet render by design; writes nothing.
  router.post("/api/receipts/sheet", verify, (req, res) => {
    const body = req.body;
    const receipt = body && typeof body === "object" && !Array.isArray(body) && body.receipt && typeof body.receipt === "object" && !Array.isArray(body.receipt)
      ? body.receipt
      : body;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      return res.status(400).json({ valid: false, reason: "malformed" });
    }
    let encoded;
    try {
      encoded = JSON.stringify(receipt);
    } catch {
      return res.status(400).json({ valid: false, reason: "malformed" });
    }
    if (encoded.length > MAX_RECEIPT_CHARS) {
      return res.status(413).json({ valid: false, reason: "too_large" });
    }
    const verdict = verifyAttestation(receipt);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(renderCalcSheetHtml(receipt, { verify: verdict }));
  });

  // Read-by-id: the stored receipt exactly as signed (migration 514), by
  // receiptId (rcpt_…) or by the signature digest. Body is the receipt itself
  // (not an envelope), so it can be POSTed straight back to /verify. GET-only;
  // no auth, no CSRF. Registered after the fixed /verify and /sheet paths and
  // matches one path segment only.
  // AUTH: public — receipts are calculation artifacts with no user data.
  router.get("/api/receipts/:id", read, (req, res) => {
    const key = String(req.params.id || "");
    if (!classifyReceiptKey(key)) return res.status(400).json({ ok: false, error: "malformed_receipt_id" });
    try {
      const receipt = getStoredReceipt(db, key);
      if (!receipt) return res.status(404).json({ ok: false, error: "receipt_not_found" });
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(receipt);
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
