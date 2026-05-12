/**
 * Concord Legal / DMCA Compliance Routes — v1.0
 *
 * API endpoints for DMCA takedown notice submission and management:
 *  - POST /api/legal/dmca/submit        — Submit a DMCA takedown notice
 *  - GET  /api/legal/dmca/:caseId        — Get DMCA case status (claimant only)
 *  - POST /api/legal/dmca/:caseId/counter — Submit counter-notification
 *  - GET  /api/legal/dmca/cases          — Admin: list all DMCA cases
 *  - POST /api/legal/dmca/:caseId/resolve — Admin: resolve a case
 *
 * Route prefix: registered directly on app at /api/legal/dmca/*
 */

import crypto from "crypto";
import { asyncHandler } from "../lib/async-handler.js";

/**
 * Generate a short prefixed unique id.
 * @param {string} prefix
 * @returns {string}
 */
function dmcaId(prefix = "dmca") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Ensure the dmca_cases table exists.
 * @param {import("better-sqlite3").Database} db
 */
function ensureDmcaTable(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS dmca_cases (
      id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      claimant_name TEXT NOT NULL,
      claimant_email TEXT NOT NULL,
      claimant_address TEXT,
      copyright_work TEXT NOT NULL,
      infringing_url TEXT,
      dtu_id TEXT,
      description TEXT NOT NULL,
      good_faith_statement INTEGER DEFAULT 0,
      accuracy_statement INTEGER DEFAULT 0,
      signature TEXT NOT NULL,
      counter_respondent_name TEXT,
      counter_respondent_email TEXT,
      counter_respondent_address TEXT,
      counter_statement TEXT,
      counter_consent_to_jurisdiction INTEGER DEFAULT 0,
      counter_signature TEXT,
      resolution TEXT,
      resolution_notes TEXT,
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);
}

/**
 * Register legal / DMCA routes on the Express app.
 *
 * @param {import("express").Application} app - Express app
 * @param {object} deps - Dependencies from server wiring
 * @param {import("better-sqlite3").Database | null} deps.db - SQLite database (may be null)
 * @param {Function} [deps.requireAuth] - Auth middleware factory
 * @param {Function} [deps.requireRole] - Role middleware factory
 * @param {Function} [deps.structuredLog] - Structured logger
 * @param {Function} [deps.auditLog] - Audit logger
 */
export default function registerLegalRoutes(app, deps) {
  const {
    db,
    requireAuth,
    requireRole,
    structuredLog = () => {},
    auditLog = () => {},
  } = deps;

  // Initialise the table on startup
  ensureDmcaTable(db);

  // ── Helper: require DB ────────────────────────────────────────────
  const requireDb = (_req, res, next) => {
    if (!db) {
      return res.status(503).json({
        ok: false,
        error: "Database unavailable. DMCA service requires persistent storage.",
      });
    }
    next();
  };

  // ── Helper: auth middleware (tolerates missing requireAuth) ────────
  const authMiddleware = typeof requireAuth === "function"
    ? requireAuth()
    : (_req, _res, next) => next();

  const adminMiddleware = typeof requireRole === "function"
    ? requireRole("owner", "admin")
    : (_req, _res, next) => next();

  // ──────────────────────────────────────────────────────────────────
  // POST /api/legal/dmca/submit — Submit DMCA takedown notice
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/api/legal/dmca/submit",
    requireDb,
    asyncHandler(async (req, res) => {
      const {
        claimantName,
        claimantEmail,
        claimantAddress,
        copyrightWork,
        infringingUrl,
        dtuId,
        description,
        goodFaithStatement,
        accuracyStatement,
        signature,
      } = req.body || {};

      // Validate required fields
      const missing = [];
      if (!claimantName) missing.push("claimantName");
      if (!claimantEmail) missing.push("claimantEmail");
      if (!copyrightWork) missing.push("copyrightWork");
      if (!description) missing.push("description");
      if (!signature) missing.push("signature");

      if (missing.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Missing required fields: ${missing.join(", ")}`,
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(claimantEmail)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid email address format.",
        });
      }

      if (!goodFaithStatement || !accuracyStatement) {
        return res.status(400).json({
          ok: false,
          error: "Both good faith and accuracy statements must be affirmed.",
        });
      }

      const caseId = dmcaId("dmca");
      const now = new Date().toISOString();

      const stmt = db.prepare(`
        INSERT INTO dmca_cases (
          id, status, claimant_name, claimant_email, claimant_address,
          copyright_work, infringing_url, dtu_id, description,
          good_faith_statement, accuracy_statement, signature,
          created_at, updated_at
        ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        caseId,
        claimantName,
        claimantEmail,
        claimantAddress || null,
        copyrightWork,
        infringingUrl || null,
        dtuId || null,
        description,
        goodFaithStatement ? 1 : 0,
        accuracyStatement ? 1 : 0,
        signature,
        now,
        now,
      );

      // Audit
      auditLog("dmca", "notice_submitted", {
        caseId,
        claimantEmail,
        dtuId: dtuId || null,
        ip: req.ip,
      });

      structuredLog("info", "dmca_notice_submitted", {
        caseId,
        claimantEmail,
        dtuId: dtuId || null,
      });

      res.status(201).json({
        ok: true,
        caseId,
        status: "pending",
        message:
          "Your DMCA takedown notice has been received. We will review it within 48 hours.",
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/legal/dmca/cases — Admin: list all DMCA cases
  // (Must be registered BEFORE the :caseId param route)
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/legal/dmca/cases",
    requireDb,
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const {
        status,
        limit = "50",
        offset = "0",
      } = req.query;

      // @select-star-ok: dmca_cases admin list
      let query = "SELECT * FROM dmca_cases";
      const params = [];

      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(Number(limit), Number(offset));

      const cases = db.prepare(query).all(...params);

      // Total count
      let countQuery = "SELECT COUNT(*) as total FROM dmca_cases";
      const countParams = [];
      if (status) {
        countQuery += " WHERE status = ?";
        countParams.push(status);
      }
      const { total } = db.prepare(countQuery).get(...countParams);

      res.json({
        ok: true,
        cases: cases.map(formatCase),
        total,
        limit: Number(limit),
        offset: Number(offset),
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/legal/dmca/:caseId — Get DMCA case status (claimant)
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/legal/dmca/:caseId",
    requireDb,
    asyncHandler(async (req, res) => {
      const { caseId } = req.params;
      const row = db.prepare("SELECT * FROM dmca_cases WHERE id = ?").get(caseId);

      if (!row) {
        return res.status(404).json({ ok: false, error: "DMCA case not found." });
      }

      // If the user is authenticated and is admin/owner, return full data.
      // Otherwise return claimant-safe subset.
      const isAdmin =
        req.user && (req.user.role === "owner" || req.user.role === "admin");

      res.json({
        ok: true,
        case: isAdmin ? formatCase(row) : formatCasePublic(row),
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // POST /api/legal/dmca/:caseId/counter — Submit counter-notification
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/api/legal/dmca/:caseId/counter",
    requireDb,
    asyncHandler(async (req, res) => {
      const { caseId } = req.params;
      const {
        respondentName,
        respondentEmail,
        respondentAddress,
        counterStatement,
        consentToJurisdiction,
        signature,
      } = req.body || {};

      // Validate required fields
      const missing = [];
      if (!respondentName) missing.push("respondentName");
      if (!respondentEmail) missing.push("respondentEmail");
      if (!counterStatement) missing.push("counterStatement");
      if (!signature) missing.push("signature");

      if (missing.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Missing required fields: ${missing.join(", ")}`,
        });
      }

      if (!consentToJurisdiction) {
        return res.status(400).json({
          ok: false,
          error: "Consent to jurisdiction is required for counter-notifications.",
        });
      }

      // Find the case
      const row = db.prepare("SELECT * FROM dmca_cases WHERE id = ?").get(caseId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "DMCA case not found." });
      }

      if (row.status === "resolved") {
        return res.status(400).json({
          ok: false,
          error: "This case has already been resolved.",
        });
      }

      if (row.counter_respondent_name) {
        return res.status(400).json({
          ok: false,
          error: "A counter-notification has already been filed for this case.",
        });
      }

      const now = new Date().toISOString();

      db.prepare(`
        UPDATE dmca_cases SET
          status = 'counter_filed',
          counter_respondent_name = ?,
          counter_respondent_email = ?,
          counter_respondent_address = ?,
          counter_statement = ?,
          counter_consent_to_jurisdiction = ?,
          counter_signature = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        respondentName,
        respondentEmail,
        respondentAddress || null,
        counterStatement,
        consentToJurisdiction ? 1 : 0,
        signature,
        now,
        caseId,
      );

      auditLog("dmca", "counter_notification_filed", {
        caseId,
        respondentEmail,
        ip: req.ip,
      });

      structuredLog("info", "dmca_counter_notification", {
        caseId,
        respondentEmail,
      });

      res.json({
        ok: true,
        caseId,
        status: "counter_filed",
        message:
          "Your counter-notification has been received. The original claimant will be notified. " +
          "If no court action is filed within 10-14 business days, the content may be restored.",
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // POST /api/legal/dmca/:caseId/resolve — Admin: resolve case
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/api/legal/dmca/:caseId/resolve",
    requireDb,
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const { caseId } = req.params;
      const { resolution, notes } = req.body || {};

      const validResolutions = ["upheld", "dismissed", "counter_filed"];
      if (!resolution || !validResolutions.includes(resolution)) {
        return res.status(400).json({
          ok: false,
          error: `Resolution must be one of: ${validResolutions.join(", ")}`,
        });
      }

      const row = db.prepare("SELECT * FROM dmca_cases WHERE id = ?").get(caseId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "DMCA case not found." });
      }

      if (row.status === "resolved") {
        return res.status(400).json({
          ok: false,
          error: "This case has already been resolved.",
        });
      }

      const now = new Date().toISOString();
      const resolvedBy = req.user?.id || req.user?.username || "system";

      db.prepare(`
        UPDATE dmca_cases SET
          status = 'resolved',
          resolution = ?,
          resolution_notes = ?,
          resolved_by = ?,
          resolved_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(resolution, notes || null, resolvedBy, now, now, caseId);

      auditLog("dmca", "case_resolved", {
        caseId,
        resolution,
        resolvedBy,
        ip: req.ip,
      });

      structuredLog("info", "dmca_case_resolved", {
        caseId,
        resolution,
        resolvedBy,
      });

      res.json({
        ok: true,
        caseId,
        status: "resolved",
        resolution,
        message: `DMCA case ${caseId} has been resolved as '${resolution}'.`,
      });
    }),
  );
}

// ── Formatting helpers ────────────────────────────────────────────────

/**
 * Format a raw DB row into a camelCase case object (admin view).
 */
function formatCase(row) {
  return {
    id: row.id,
    status: row.status,
    claimantName: row.claimant_name,
    claimantEmail: row.claimant_email,
    claimantAddress: row.claimant_address,
    copyrightWork: row.copyright_work,
    infringingUrl: row.infringing_url,
    dtuId: row.dtu_id,
    description: row.description,
    goodFaithStatement: !!row.good_faith_statement,
    accuracyStatement: !!row.accuracy_statement,
    signature: row.signature,
    counterRespondentName: row.counter_respondent_name,
    counterRespondentEmail: row.counter_respondent_email,
    counterRespondentAddress: row.counter_respondent_address,
    counterStatement: row.counter_statement,
    counterConsentToJurisdiction: !!row.counter_consent_to_jurisdiction,
    counterSignature: row.counter_signature,
    resolution: row.resolution,
    resolutionNotes: row.resolution_notes,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Format a raw DB row into a public-safe subset (claimant view).
 * Omits sensitive counter-notification contact details.
 */
function formatCasePublic(row) {
  return {
    id: row.id,
    status: row.status,
    copyrightWork: row.copyright_work,
    infringingUrl: row.infringing_url,
    dtuId: row.dtu_id,
    description: row.description,
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}
