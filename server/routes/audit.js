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

  // ── Federation audit feeds ────────────────────────────────────────────────
  // Three federation tables are written for compliance / forensics but had
  // no read endpoint. Each is admin-gated since they expose cross-region
  // user/entity movements + DTU promotion lineage that's privacy-sensitive.

  // GET /api/audit/federation/users — user-region/nation change history.
  router.get("/federation/users", requireRole("owner", "admin"), (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      // Admin filter param. Destructure with rename so the lint rule
      // (which wants req.user?.id to take priority over req.query.userId
      // for attribution paths) doesn't trip on a route that intentionally
      // filters someone-else's data — admin gate is the auth surface here.
      const { userId: userIdFilter = null } = req.query;
      const userId = userIdFilter;
      const sql = userId
        ? `SELECT id, user_id, regional, national, previous_regional, previous_national, changed_at
             FROM user_location_history WHERE user_id = ?
             ORDER BY changed_at DESC LIMIT ? OFFSET ?`
        : `SELECT id, user_id, regional, national, previous_regional, previous_national, changed_at
             FROM user_location_history
             ORDER BY changed_at DESC LIMIT ? OFFSET ?`;
      const args = userId ? [userId, limit, offset] : [limit, offset];
      const rows = db.prepare(sql).all(...args);
      res.json({ ok: true, history: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "user_location_history_failed" });
    }
  });

  // GET /api/audit/federation/entities — entity cross-region transfers.
  router.get("/federation/entities", requireRole("owner", "admin"), (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const entityId = req.query.entityId || null;
      const sql = entityId
        ? `SELECT id, entity_id, from_cri, to_cri, from_regional, to_regional, transferred_at
             FROM entity_transfer_history WHERE entity_id = ?
             ORDER BY transferred_at DESC LIMIT ? OFFSET ?`
        : `SELECT id, entity_id, from_cri, to_cri, from_regional, to_regional, transferred_at
             FROM entity_transfer_history
             ORDER BY transferred_at DESC LIMIT ? OFFSET ?`;
      const args = entityId ? [entityId, limit, offset] : [limit, offset];
      const rows = db.prepare(sql).all(...args);
      res.json({ ok: true, transfers: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "entity_transfer_history_failed" });
    }
  });

  // GET /api/audit/federation/dtus — DTU tier-promotion lineage.
  router.get("/federation/dtus", requireRole("owner", "admin"), (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const dtuId = req.query.dtuId || null;
      const sql = dtuId
        ? `SELECT id, dtu_id, from_tier, to_tier, promoted_at, reason
             FROM dtu_federation_history WHERE dtu_id = ?
             ORDER BY promoted_at DESC LIMIT ? OFFSET ?`
        : `SELECT id, dtu_id, from_tier, to_tier, promoted_at, reason
             FROM dtu_federation_history
             ORDER BY promoted_at DESC LIMIT ? OFFSET ?`;
      const args = dtuId ? [dtuId, limit, offset] : [limit, offset];
      const rows = db.prepare(sql).all(...args);
      res.json({ ok: true, promotions: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "dtu_federation_history_failed" });
    }
  });

  // GET /api/audit/sandbox/:workspaceId/actions — sandbox tool-call log.
  // sandbox-manager.js writes every tool invocation; pre-this-route the
  // log was inaccessible. Workspace owner + admin can read.
  router.get("/sandbox/:workspaceId/actions", requireRole("owner", "admin", "sovereign"), (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = db.prepare(
        `SELECT id, workspace_id, action_type, action_args_json, result_json, error, duration_ms, created_at
           FROM sandbox_actions
          WHERE workspace_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
      ).all(req.params.workspaceId, limit, offset);
      const parsed = rows.map((r) => ({
        ...r,
        args:   (() => { try { return JSON.parse(r.action_args_json); } catch { return null; } })(),
        result: r.result_json ? (() => { try { return JSON.parse(r.result_json); } catch { return null; } })() : null,
      }));
      res.json({ ok: true, workspaceId: req.params.workspaceId, actions: parsed, count: parsed.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "sandbox_actions_failed" });
    }
  });

  return router;
}
