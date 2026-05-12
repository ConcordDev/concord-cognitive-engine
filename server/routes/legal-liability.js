/**
 * Concord Legal Liability Routes — v1.0
 *
 * API endpoints for legal framework:
 *  - Legal position and disclaimers
 *  - User agreement recording
 *  - DMCA notice submission and processing
 *  - Copyright strike management
 *  - Dispute resolution
 *  - Disclaimer acknowledgment
 *  - Legal dashboard
 */

import express from "express";
import {
  LEGAL_POSITION,
  LENS_DISCLAIMER,
  LENS_SPECIFIC_DISCLAIMERS,
  DMCA_COMPLIANCE,
  DISPUTE_RESOLUTION,
  TERMS_OF_SERVICE,
  LIABILITY_SHIELD,
  CONTENT_LABELING,
  LEGAL_CONSTANTS,
} from "../lib/legal-liability-constants.js";
import {
  recordAgreement,
  hasAgreed,
  getUserAgreements,
  submitDMCANotice,
  reviewDMCANotice,
  submitCounterNotification,
  getDMCANotice,
  getDMCANotices,
  issueStrike,
  getStrikeCount,
  getUserStrikes,
  appealStrike,
  resolveAppeal,
  openDispute,
  updateDisputeStatus,
  getDispute,
  getDisputes,
  acknowledgeDisclaimer,
  hasAcknowledgedDisclaimer,
  getContentLabel,
  getDisclaimerForLens,
  getAllDisclaimers,
  getLegalDashboard,
} from "../economy/legal-liability.js";

export default function createLegalLiabilityRouter({ db, requireAuth }) {
  const router = express.Router();

  // Auth for writes: POST/PUT/DELETE/PATCH require authentication
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return next();
  };
  router.use(authForWrites);

  // ── Config ──────────────────────────────────────────────────────────
  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      legalPosition: LEGAL_POSITION,
      dmca: DMCA_COMPLIANCE,
      disputeResolution: DISPUTE_RESOLUTION,
      termsOfService: TERMS_OF_SERVICE,
      liabilityShield: LIABILITY_SHIELD,
      contentLabeling: CONTENT_LABELING,
      constants: LEGAL_CONSTANTS,
    });
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  router.get("/dashboard", (_req, res) => {
    const dashboard = getLegalDashboard(db);
    res.json(dashboard);
  });

  // ── Disclaimers ─────────────────────────────────────────────────────
  router.get("/disclaimers", (_req, res) => {
    res.json({ ok: true, ...getAllDisclaimers() });
  });

  router.get("/disclaimers/:lensId", (req, res) => {
    const disclaimer = getDisclaimerForLens(req.params.lensId);
    res.json({ ok: true, ...disclaimer });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/disclaimers/acknowledge", (req, res) => {
    const { userId, lensId } = req.body || {};
    if (!userId || !lensId) return res.status(400).json({ ok: false, error: "missing_required_fields" });
    const result = acknowledgeDisclaimer(db, { userId, lensId });
    res.json(result);
  });

  router.get("/disclaimers/check/:userId/:lensId", (req, res) => {
    const acknowledged = hasAcknowledgedDisclaimer(db, req.params.userId, req.params.lensId);
    res.json({ ok: true, acknowledged });
  });

  // ── User Agreements ─────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/agreements", (req, res) => {
    const { userId, agreementType, ipAddress } = req.body || {};
    if (!userId || !agreementType) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const result = recordAgreement(db, { userId, agreementType, ipAddress });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/agreements/:userId", (req, res) => {
    const agreements = getUserAgreements(db, req.params.userId);
    res.json({ ok: true, agreements, count: agreements.length });
  });

  router.get("/agreements/check/:userId/:type", (req, res) => {
    const agreed = hasAgreed(db, req.params.userId, req.params.type);
    res.json({ ok: true, agreed });
  });

  router.get("/agreements/types", (_req, res) => {
    res.json({ ok: true, types: TERMS_OF_SERVICE.agreements });
  });

  // ── DMCA ────────────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dmca/submit", (req, res) => {
    const result = submitDMCANotice(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dmca/:id/review", (req, res) => {
    const { valid, notes } = req.body || {};
    const result = reviewDMCANotice(db, req.params.id, { valid, notes });
    res.json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/dmca/:id/counter", (req, res) => {
    const result = submitCounterNotification(db, req.params.id, req.body || {});
    res.json(result);
  });

  router.get("/dmca/:id", (req, res) => {
    const notice = getDMCANotice(db, req.params.id);
    if (!notice) return res.status(404).json({ ok: false, error: "notice_not_found" });
    res.json({ ok: true, notice });
  });

  router.get("/dmca", (req, res) => {
    const { status, limit } = req.query;
    const notices = getDMCANotices(db, { status, limit: parseInt(limit) || 50 });
    res.json({ ok: true, notices, count: notices.length });
  });

  // ── Copyright Strikes ───────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/strikes", (req, res) => {
    const { userId, dmcaNoticeId } = req.body || {};
    if (!userId || !dmcaNoticeId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const result = issueStrike(db, { userId, dmcaNoticeId });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/strikes/:userId", (req, res) => {
    const strikes = getUserStrikes(db, req.params.userId);
    const count = getStrikeCount(db, req.params.userId);
    res.json({
      ok: true,
      strikes,
      activeCount: count,
      maxStrikes: LEGAL_CONSTANTS.MAX_STRIKES,
      terminated: count >= LEGAL_CONSTANTS.MAX_STRIKES,
    });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/strikes/:id/appeal", (req, res) => {
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ ok: false, error: "reason_required" });
    const result = appealStrike(db, req.params.id, { reason });
    res.json(result);
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/strikes/:id/resolve-appeal", (req, res) => {
    const { result: appealResult } = req.body || {};
    const result = resolveAppeal(db, req.params.id, { result: appealResult });
    res.json(result);
  });

  // ── Disputes ────────────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/disputes", (req, res) => {
    const result = openDispute(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/disputes", (req, res) => {
    const { status, type, limit } = req.query;
    const disputes = getDisputes(db, { status, disputeType: type, limit: parseInt(limit) || 50 });
    res.json({ ok: true, disputes, count: disputes.length });
  });

  router.get("/disputes/:id", (req, res) => {
    const dispute = getDispute(db, req.params.id);
    if (!dispute) return res.status(404).json({ ok: false, error: "dispute_not_found" });
    res.json({ ok: true, dispute });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.patch("/disputes/:id", (req, res) => {
    const { status, resolution } = req.body || {};
    if (!status) return res.status(400).json({ ok: false, error: "status_required" });
    const result = updateDisputeStatus(db, req.params.id, { status, resolution });
    res.json(result);
  });

  // ── Content Labeling ────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/label", (req, res) => {
    const label = getContentLabel(req.body || {});
    res.json({ ok: true, label });
  });

  router.get("/labeling-rules", (_req, res) => {
    res.json({ ok: true, labeling: CONTENT_LABELING });
  });

  // ── Legal Position ──────────────────────────────────────────────────
  router.get("/position", (_req, res) => {
    res.json({ ok: true, position: LEGAL_POSITION });
  });

  router.get("/shield", (_req, res) => {
    res.json({ ok: true, shield: LIABILITY_SHIELD });
  });

  return router;
}
