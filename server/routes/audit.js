/**
 * Audit log routes — queryable audit trail endpoints.
 * Mounted at /api/audit
 */
import express from "express";
import { getAuditLog, getAuditLogForUser } from "../lib/audit-logger.js";

/**
 * Create the audit-log router.
 *
 * @param {object} deps
 * @param {Function} deps.requireRole - RBAC middleware (e.g. requireRole("owner","admin"))
 * @param {object}   [deps.db]        - SQLite connection (used by /wash-trades).
 * @returns {import('express').Router}
 */
export default function createAuditRouter({ requireRole, db = null }) {
  const router = express.Router();

  // ── GET /api/audit — admin-only: list all audit entries ────────────────────
  router.get("/", requireRole("owner", "admin"), (req, res) => {
    const {
      actor,
      action,
      target,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = req.query;

    const result = getAuditLog({
      actor,
      action,
      target,
      startDate,
      endDate,
      limit:  Math.max(1, Math.min(Number(limit)  || 50, 200)),
      offset: Math.max(0, Number(offset) || 0),
    });

    res.json({ ok: true, ...result });
  });

  // ── GET /api/audit/me — authenticated user's own audit trail ──────────────
  router.get("/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { action, startDate, endDate, limit = 50, offset = 0 } = req.query;

    const result = getAuditLogForUser(req.user.id, {
      action,
      startDate,
      endDate,
      limit:  Math.max(1, Math.min(Number(limit)  || 50, 200)),
      offset: Math.max(0, Number(offset) || 0),
    });

    res.json({ ok: true, ...result });
  });

  // ── GET /api/audit/dtu/:id — audit trail for a specific DTU ───────────────
  router.get("/dtu/:id", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const dtuId = req.params.id;
    const { action, startDate, endDate, limit = 50, offset = 0 } = req.query;

    const result = getAuditLog({
      target: dtuId,
      action,
      startDate,
      endDate,
      limit:  Math.max(1, Math.min(Number(limit)  || 50, 200)),
      offset: Math.max(0, Number(offset) || 0),
    });

    res.json({ ok: true, ...result });
  });

  // ── GET /api/audit/wash-trades — admin-only: marketplace integrity feed ───
  // marketplace-service.js detects circular trades and writes to
  // wash_trade_flags, but pre-this-route nothing read those flags. Admin
  // surfaces (compliance dashboard, fraud-team review) consume this.
  router.get("/wash-trades", requireRole("owner", "admin"), (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const accountFilter = req.query.account || null;
      const sql = accountFilter
        ? `SELECT id, account_a, account_b, content_id, trade_count, flagged_at
             FROM wash_trade_flags
            WHERE account_a = ? OR account_b = ?
            ORDER BY flagged_at DESC
            LIMIT ? OFFSET ?`
        : `SELECT id, account_a, account_b, content_id, trade_count, flagged_at
             FROM wash_trade_flags
            ORDER BY flagged_at DESC
            LIMIT ? OFFSET ?`;
      const args = accountFilter
        ? [accountFilter, accountFilter, limit, offset]
        : [limit, offset];
      const flags = db.prepare(sql).all(...args);
      res.json({ ok: true, flags, count: flags.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "wash_trade_query_failed" });
    }
  });

  return router;
}
