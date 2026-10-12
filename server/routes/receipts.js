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

const MAX_RECEIPT_CHARS = 1_500_000;

export default function createReceiptRouter({ readLimit, verifyLimit } = {}) {
  const router = express.Router();
  const read = readLimit || ((_req, _res, next) => next());
  const verify = verifyLimit || ((_req, _res, next) => next());

  router.get("/.well-known/concord-receipt-keys.json", read, async (_req, res) => {
    try {
      await ensureSigningKey();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(publicKeyDocument());
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // AUTH: public — verification reads a caller-supplied receipt and returns {valid, reason}; it writes nothing. CSRF-exempt on this exact path only.
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

  return router;
}
