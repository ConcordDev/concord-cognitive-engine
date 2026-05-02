/**
 * Account Lifecycle Routes — Deletion, Export, Disputes, ToS, Legal Docs
 *
 * Implements the backend for:
 * - ToS Section 3.3: Account deletion
 * - ToS Section 8: Disputes and refunds
 * - Privacy Policy Section 6.3: Data export
 * - Privacy Policy Section 6.4: Right to erasure
 * - Seller verification gates
 */

import express from "express";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  exportUserData,
  mergeAccounts,
  checkSellerEligibility,
  requestRefund,
  resolveDispute,
  getUserDisputes,
} from "../lib/account-lifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create the account lifecycle router.
 */
export default function createAccountLifecycleRouter({ db, requireAuth, adminOnly }) {
  const router = express.Router();

  // All routes require auth unless noted
  const auth = typeof requireAuth === "function" ? requireAuth() : (_req, _res, next) => next();

  // ── Legal Documents (public) ─────────────────────────────────────────

  router.get("/legal/terms", (_req, res) => {
    try {
      const tos = readFileSync(join(__dirname, "../../docs/TERMS_OF_SERVICE.md"), "utf-8");
      res.json({ ok: true, document: tos, format: "markdown" });
    } catch {
      res.status(404).json({ ok: false, error: "terms_not_found" });
    }
  });

  router.get("/legal/privacy", (_req, res) => {
    try {
      const pp = readFileSync(join(__dirname, "../../docs/PRIVACY_POLICY.md"), "utf-8");
      res.json({ ok: true, document: pp, format: "markdown" });
    } catch {
      res.status(404).json({ ok: false, error: "privacy_policy_not_found" });
    }
  });

  // ── ToS Acceptance ───────────────────────────────────────────────────

  router.post("/legal/accept-tos", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    try {
      db.prepare("UPDATE users SET tos_accepted_at = ? WHERE id = ?").run(now, userId);
      res.json({ ok: true, acceptedAt: now });
    } catch {
      res.status(500).json({ ok: false, error: "tos_acceptance_failed" });
    }
  });

  // ── Account Deletion ─────────────────────────────────────────────────

  router.post("/account/delete", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    // Require explicit confirmation
    if (req.body?.confirm !== "DELETE_MY_ACCOUNT") {
      return res.status(400).json({
        ok: false,
        error: "confirmation_required",
        detail: "Send { confirm: 'DELETE_MY_ACCOUNT' } to proceed.",
      });
    }

    const result = requestAccountDeletion(db, userId, {
      ip: req.ip,
      userAgent: req.headers?.["user-agent"],
    });

    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/account/cancel-deletion", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const result = cancelAccountDeletion(db, userId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ── Data Export ──────────────────────────────────────────────────────

  router.get("/account/export", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const result = exportUserData(db, userId);
    if (!result.ok) return res.status(400).json(result);

    // Set headers for download
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="concord-data-export-${userId}.json"`);
    res.json(result.data);
  });

  // ── Account Merge ─────────────────────────────────────────────────────
  // POST /api/account/merge { sourceUserId, mergeToken }
  // The merge token is a short-lived (10 min) JWT issued by /api/account/merge-token
  // when both accounts authenticate via different providers. Caller is the
  // "survivor" account; sourceUserId is the account whose data gets reassigned.

  router.post("/account/merge", auth, (req, res) => {
    const survivorUserId = req.user?.id;
    if (!survivorUserId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { sourceUserId, mergeToken } = req.body || {};
    if (!sourceUserId || !mergeToken) {
      return res.status(400).json({ ok: false, error: "missing_source_or_token" });
    }

    // Verify the merge token (issued by /merge-token after the source account
    // re-authenticated). Token payload: { sourceUserId, exp }.
    let tokenPayload;
    try {
      const jwt = require("jsonwebtoken");
      tokenPayload = jwt.verify(mergeToken, process.env.JWT_SECRET || "dev_secret");
    } catch {
      return res.status(401).json({ ok: false, error: "invalid_merge_token" });
    }
    if (tokenPayload.sourceUserId !== sourceUserId) {
      return res.status(401).json({ ok: false, error: "token_mismatch" });
    }

    const result = mergeAccounts(db, {
      survivorUserId,
      sourceUserId,
      actorId: survivorUserId,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Issue a merge token after the source account authenticates. The user
  // requests it from the source-account session, then pastes the token into
  // their survivor session to confirm the merge.
  router.post("/account/merge-token", auth, (req, res) => {
    const sourceUserId = req.user?.id;
    if (!sourceUserId) return res.status(401).json({ ok: false, error: "unauthorized" });
    try {
      const jwt = require("jsonwebtoken");
      const token = jwt.sign(
        { sourceUserId, kind: "account_merge", exp: Math.floor(Date.now() / 1000) + 600 },
        process.env.JWT_SECRET || "dev_secret",
      );
      res.json({ ok: true, mergeToken: token, expiresInSec: 600 });
    } catch (err) {
      res.status(500).json({ ok: false, error: "token_issue_failed" });
    }
  });

  // ── Seller Verification ──────────────────────────────────────────────

  router.get("/seller/eligibility", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const result = checkSellerEligibility(db, userId);
    res.json({ ok: true, ...result });
  });

  // ── Disputes / Refunds ───────────────────────────────────────────────

  router.post("/disputes", auth, (req, res) => {
    const buyerId = req.user?.id;
    if (!buyerId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { purchaseId, reason } = req.body || {};
    if (!purchaseId || !reason) {
      return res.status(400).json({ ok: false, error: "missing_purchase_id_or_reason" });
    }

    const result = requestRefund(db, { purchaseId, buyerId, reason });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/disputes", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const result = getUserDisputes(db, userId, {
      limit: Math.min(parseInt(req.query.limit) || 50, 200),
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(result);
  });

  // Admin: resolve disputes
  router.post("/disputes/:id/resolve", auth, (req, res) => {
    // Check admin
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, error: "admin_required" });
    }

    const { resolution, partialAmount, notes } = req.body || {};
    const result = resolveDispute(db, {
      disputeId: req.params.id,
      resolution,
      adminId: req.user.id,
      partialAmount,
      notes,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}
