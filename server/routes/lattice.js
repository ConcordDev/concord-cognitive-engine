// server/routes/lattice.js
//
// Lattice (6th brain) substrate management endpoints.
//
//   POST   /api/lattice/dtus/:id/consent  — opt this DTU into training (auth: must own)
//   DELETE /api/lattice/dtus/:id/consent  — opt out
//   POST   /api/lattice/dtus/consent-all  — flip every owned DTU
//   GET    /api/lattice/corpus/stats      — counts per consent table
//   GET    /api/lattice/corpus/mine       — caller's consent state
//   GET    /api/lattice/consent-log       — append-only audit of consent toggles
//   GET    /api/lattice/drift-alerts      — recent drift/eval-regression alerts
//
// The Lattice brain itself isn't deployed yet — these endpoints stage
// the consent infrastructure so by the time training is ready, every
// row created from now forward already carries the right flag.

import { Router } from "express";
import crypto from "node:crypto";
import {
  setDtuTrainConsent,
  setAllDtusTrainConsent,
  getCorpusStats,
} from "../lib/training-consent.js";

/**
 * Append a row to lattice_consent_log. Fail-safe — never throws (the
 * audit trail is a side-effect, it must never block a consent change).
 */
function logConsent(db, { userId, action, dtuId = null, oldValue = null, newValue, affected = 1 }) {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO lattice_consent_log
        (id, user_id, action, dtu_id, old_value, new_value, affected)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `lcl_${crypto.randomBytes(8).toString("hex")}`,
      userId, action, dtuId,
      oldValue == null ? null : (oldValue ? 1 : 0),
      newValue ? 1 : 0,
      Number.isFinite(affected) ? affected : 1,
    );
  } catch (_e) { /* table may not exist on older DBs — fail silent */ }
}

export default function createLatticeRouter({ db, requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

  // POST /api/lattice/dtus/:id/consent — opt this DTU in.
  router.post("/dtus/:id/consent", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const prior = db?.prepare(`SELECT train_consented FROM dtus WHERE id = ?`).get(req.params.id);
    // body.consented may be false (a POST-shaped toggle-off from the lens)
    const target = req.body?.consented === false ? false : true;
    const result = setDtuTrainConsent(db, req.params.id, userId, target);
    if (!result.ok) {
      const status = result.error === "not_owner" ? 403 : result.error === "dtu_not_found" ? 404 : 400;
      return res.status(status).json(result);
    }
    logConsent(db, {
      userId, action: "toggle", dtuId: req.params.id,
      oldValue: prior ? prior.train_consented : null, newValue: target,
    });
    res.json(result);
  });

  // DELETE /api/lattice/dtus/:id/consent — opt this DTU out.
  router.delete("/dtus/:id/consent", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const prior = db?.prepare(`SELECT train_consented FROM dtus WHERE id = ?`).get(req.params.id);
    const result = setDtuTrainConsent(db, req.params.id, userId, false);
    if (!result.ok) {
      const status = result.error === "not_owner" ? 403 : result.error === "dtu_not_found" ? 404 : 400;
      return res.status(status).json(result);
    }
    logConsent(db, {
      userId, action: "toggle", dtuId: req.params.id,
      oldValue: prior ? prior.train_consented : null, newValue: false,
    });
    res.json(result);
  });

  // POST /api/lattice/dtus/consent-all — bulk flip every DTU owned by caller.
  // Body: { consented: boolean }
  router.post("/dtus/consent-all", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const consented = req.body?.consented !== false; // default true unless explicit false
    const result = setAllDtusTrainConsent(db, userId, consented);
    if (result.ok) {
      logConsent(db, {
        userId, action: "bulk", dtuId: null,
        oldValue: null, newValue: consented, affected: result.updated || 0,
      });
    }
    res.json(result);
  });

  // GET /api/lattice/consent-log — append-only audit of who toggled what,
  // when. Caller sees only their own rows. ?limit= (default 60, max 200).
  router.get("/consent-log", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    try {
      if (!db) return res.json({ ok: true, log: [] });
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
      const rows = db.prepare(
        `SELECT id, action, dtu_id, old_value, new_value, affected, created_at
           FROM lattice_consent_log
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
      ).all(userId, limit);
      res.json({ ok: true, log: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/lattice/drift-alerts — recent drift / eval-regression alerts.
  // Surfaces the in-memory drift-monitor store (the drift_alert macro emits
  // socket events; this endpoint exposes the persisted alert history so the
  // Lattice lens can render an alerting panel). ?severity=&type=&limit=.
  router.get("/drift-alerts", async (req, res) => {
    try {
      const STATE = globalThis._concordSTATE || globalThis.STATE || null;
      if (!STATE) return res.json({ ok: true, alerts: [], total: 0, available: false });
      const filters = { limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200) };
      if (req.query.severity) filters.severity = String(req.query.severity);
      if (req.query.type) filters.type = String(req.query.type);
      let getDriftAlerts = null;
      try {
        ({ getDriftAlerts } = await import("../emergent/drift-monitor.js"));
      } catch (_e) { getDriftAlerts = null; }
      if (typeof getDriftAlerts !== "function") {
        const store = STATE._driftStore;
        const alerts = Array.isArray(store?.alerts) ? store.alerts.slice(-filters.limit) : [];
        return res.json({ ok: true, alerts, total: alerts.length, available: !!store });
      }
      const out = getDriftAlerts(STATE, filters);
      res.json({ ok: true, ...out, available: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/lattice/corpus/stats — public-ish (anonymized counts only).
  // Useful for a public "Lattice training corpus is now N consented rows" widget.
  router.get("/corpus/stats", (_req, res) => {
    try {
      const stats = getCorpusStats(db);
      const totals = stats.tables.reduce(
        (acc, t) => ({ total: acc.total + t.total, consented: acc.consented + t.consented }),
        { total: 0, consented: 0 },
      );
      res.json({
        ok: true,
        ...stats,
        totals: {
          ...totals,
          ratio: totals.total === 0 ? 0 : Number((totals.consented / totals.total).toFixed(4)),
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/lattice/corpus/mine — caller's per-DTU consent state.
  router.get("/corpus/mine", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    try {
      const summary = db.prepare(
        `SELECT
            COUNT(*) AS total,
            COALESCE(SUM(train_consented), 0) AS consented
          FROM dtus
          WHERE creator_id = ?`,
      ).get(userId);
      res.json({
        ok: true,
        userId,
        total: summary.total,
        consented: summary.consented,
        ratio: summary.total === 0 ? 0 : Number((summary.consented / summary.total).toFixed(4)),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
