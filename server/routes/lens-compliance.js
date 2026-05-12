/**
 * Universal Lens Compliance Routes — v1.0
 *
 * API endpoints for the lens compliance framework:
 *  - Dashboard and config
 *  - Lens registration and compliance submission
 *  - Compliance validation (manual and nightly)
 *  - Upgrade propagation
 *  - Audit history
 */

import express from "express";
import {
  LENS_CLASSIFICATION,
  LENS_INTERFACE,
  LENS_COMPLIANCE_VALIDATOR,
  LENS_COMPLIANCE_CONSTANTS,
  LENS_CREATOR_GATE,
  PENDING_UPGRADES,
} from "../lib/lens-compliance-constants.js";
import {
  runLensCompliance,
  runNightlyAudit,
  getAllActiveLenses,
  getLensById,
  registerLens,
  disableLens,
  enableLens,
  submitLensForCompliance,
  propagateUpgrade,
  getUpgradeStatus,
  getLatestComplianceResult,
  getComplianceHistory,
  getLatestAudit,
  getAuditHistory,
  getComplianceDashboard,
} from "../economy/lens-compliance.js";

export default function createLensComplianceRouter({ db, requireAuth }) {
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
      classification: LENS_CLASSIFICATION,
      interface: LENS_INTERFACE,
      validator: LENS_COMPLIANCE_VALIDATOR,
      constants: LENS_COMPLIANCE_CONSTANTS,
      creatorGate: LENS_CREATOR_GATE,
      pendingUpgrades: PENDING_UPGRADES,
    });
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  router.get("/dashboard", (_req, res) => {
    const dashboard = getComplianceDashboard(db);
    res.json(dashboard);
  });

  // ── Lens Registry ───────────────────────────────────────────────────
  router.get("/lenses", (_req, res) => {
    const lenses = getAllActiveLenses(db);
    res.json({ ok: true, lenses, count: lenses.length });
  });

  router.get("/lenses/:id", (req, res) => {
    const lens = getLensById(db, req.params.id);
    if (!lens) return res.status(404).json({ ok: false, error: "lens_not_found" });
    const latestCompliance = getLatestComplianceResult(db, req.params.id);
    res.json({ ok: true, lens, latestCompliance });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lenses/register", (req, res) => {
    const { name, classification, version, protection_mode, creator_id, creator_type, federation_tiers, artifact_types, config } = req.body || {};
    if (!name || !classification) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "name and classification are required" });
    }
    const result = registerLens(db, { name, classification, version, protection_mode, creator_id, creator_type, federation_tiers, artifact_types, config });
    res.status(result.ok ? 201 : 400).json(result);
  });

  // ── Compliance Submission (Creator Gate) ────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lenses/:id/submit", (req, res) => {
    const lens = getLensById(db, req.params.id);
    if (!lens) return res.status(404).json({ ok: false, error: "lens_not_found" });
    const result = submitLensForCompliance(db, lens);
    res.json(result);
  });

  // ── Manual Compliance Validation ────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lenses/:id/validate", (req, res) => {
    const lens = getLensById(db, req.params.id);
    if (!lens) return res.status(404).json({ ok: false, error: "lens_not_found" });
    const result = runLensCompliance(lens, db);
    res.json({ ok: true, result });
  });

  // ── Compliance History ──────────────────────────────────────────────
  router.get("/lenses/:id/compliance-history", (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const history = getComplianceHistory(db, req.params.id, limit);
    res.json({ ok: true, history, count: history.length });
  });

  // ── Enable/Disable Lens ─────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lenses/:id/disable", (req, res) => {
    const { reason } = req.body || {};
    disableLens(req.params.id, reason || "manual_disable", "manual", db);
    res.json({ ok: true, lensId: req.params.id, status: "disabled" });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lenses/:id/enable", (req, res) => {
    enableLens(req.params.id, db);
    res.json({ ok: true, lensId: req.params.id, status: "active" });
  });

  // ── Nightly Audit ───────────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/audit/run", (_req, res) => {
    const result = runNightlyAudit(db);
    res.json({ ok: true, result });
  });

  router.get("/audit/latest", (_req, res) => {
    const audit = getLatestAudit(db);
    if (!audit) return res.json({ ok: true, audit: null, message: "No audits run yet" });
    res.json({ ok: true, audit });
  });

  router.get("/audit/history", (req, res) => {
    const limit = parseInt(req.query.limit) || 30;
    const history = getAuditHistory(db, limit);
    res.json({ ok: true, history, count: history.length });
  });

  // ── Upgrade Propagation ─────────────────────────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/upgrades/propagate", (req, res) => {
    const { name, description, newChecks, appliesTo, requiredByDate } = req.body || {};
    if (!name || !newChecks) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "name and newChecks are required" });
    }
    const result = propagateUpgrade(db, { name, description, newChecks, appliesTo, requiredByDate });
    res.json(result);
  });

  router.get("/upgrades/:id", (req, res) => {
    const upgrade = getUpgradeStatus(db, req.params.id);
    if (!upgrade) return res.status(404).json({ ok: false, error: "upgrade_not_found" });
    res.json({ ok: true, upgrade });
  });

  router.get("/upgrades", (_req, res) => {
    try {
      // @select-star-ok: lens_upgrades admin list
      const upgrades = db.prepare("SELECT * FROM lens_upgrades ORDER BY created_at DESC").all();
      res.json({ ok: true, upgrades });
    } catch {
      res.json({ ok: true, upgrades: [] });
    }
  });

  // ── Pending Upgrades (from spec) ────────────────────────────────────
  router.get("/pending-upgrades", (_req, res) => {
    res.json({ ok: true, upgrades: PENDING_UPGRADES });
  });

  // ── Classification Lookup ───────────────────────────────────────────
  router.get("/classifications", (_req, res) => {
    res.json({ ok: true, classification: LENS_CLASSIFICATION });
  });

  router.get("/classifications/:class", (req, res) => {
    const cls = LENS_CLASSIFICATION.classes[req.params.class.toUpperCase()];
    if (!cls) return res.status(404).json({ ok: false, error: "classification_not_found" });
    res.json({ ok: true, classification: cls });
  });

  // ── Validator Info ──────────────────────────────────────────────────
  router.get("/validator/phases", (_req, res) => {
    res.json({
      ok: true,
      phases: LENS_COMPLIANCE_VALIDATOR.phases,
      totalPhases: LENS_COMPLIANCE_VALIDATOR.phases.length,
      triggers: LENS_COMPLIANCE_VALIDATOR.triggers,
    });
  });

  return router;
}
