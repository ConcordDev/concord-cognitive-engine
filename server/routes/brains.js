// server/routes/brains.js
//
// Brain-self-training inspection + admin endpoints.
//
//   GET  /api/brains/stats          — corpus + interaction counts per brain
//   GET  /api/brains/active         — currently-active model per brain
//   GET  /api/brains/:id/history    — recent training-run history
//   POST /api/brains/refresh        — admin-triggered immediate refresh
//                                     (otherwise runs daily 23:30-23:59)

import { Router } from "express";

import { getBrainCorpusStats } from "../lib/brain-training/interaction-log.js";
import { runDailyRefresh } from "../lib/brain-training/runner.js";

export default function createBrainsRouter({ db, requireAuth, requireRole }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;
  const adminGate = typeof requireRole === "function" ? requireRole("owner", "admin", "sovereign") : auth;

  // GET /api/brains/stats — public-ish counts (no individual prompts exposed).
  router.get("/stats", (_req, res) => {
    try {
      const stats = getBrainCorpusStats(db);
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/brains/active — currently-active model per brain.
  router.get("/active", (_req, res) => {
    try {
      const rows = db ? db.prepare(
        `SELECT brain_id, model_name, base_model, corpus_size, eval_score, created_at
           FROM brain_active_models
          WHERE active = 1
          ORDER BY brain_id`,
      ).all() : [];
      res.json({ ok: true, active: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/brains/:brainId/history — last N training runs for one brain.
  router.get("/:brainId/history", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
      const rows = db ? db.prepare(
        `SELECT id, model_name, base_model, corpus_size, eval_score, active, created_at, retired_at
           FROM brain_active_models
          WHERE brain_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
      ).all(req.params.brainId, limit) : [];
      res.json({ ok: true, brainId: req.params.brainId, history: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/brains/refresh — admin-only manual trigger. Bypasses the
  // 23:30-23:59 time-window gate. Body: { force: boolean } (default true).
  router.post("/refresh", adminGate, async (req, res) => {
    try {
      const force = req.body?.force !== false;
      const result = await runDailyRefresh(db, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
