// server/routes/lattice.js
//
// Lattice (6th brain) substrate management endpoints.
//
//   POST   /api/lattice/dtus/:id/consent  — opt this DTU into training (auth: must own)
//   DELETE /api/lattice/dtus/:id/consent  — opt out
//   POST   /api/lattice/dtus/consent-all  — flip every owned DTU
//   GET    /api/lattice/corpus/stats      — counts per consent table
//   GET    /api/lattice/corpus/mine       — caller's consent state
//
// The Lattice brain itself isn't deployed yet — these endpoints stage
// the consent infrastructure so by the time training is ready, every
// row created from now forward already carries the right flag.

import { Router } from "express";
import {
  setDtuTrainConsent,
  setAllDtusTrainConsent,
  getCorpusStats,
} from "../lib/training-consent.js";

export default function createLatticeRouter({ db, requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

  // POST /api/lattice/dtus/:id/consent — opt this DTU in.
  router.post("/dtus/:id/consent", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const result = setDtuTrainConsent(db, req.params.id, userId, true);
    if (!result.ok) {
      const status = result.error === "not_owner" ? 403 : result.error === "dtu_not_found" ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  });

  // DELETE /api/lattice/dtus/:id/consent — opt this DTU out.
  router.delete("/dtus/:id/consent", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const result = setDtuTrainConsent(db, req.params.id, userId, false);
    if (!result.ok) {
      const status = result.error === "not_owner" ? 403 : result.error === "dtu_not_found" ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  });

  // POST /api/lattice/dtus/consent-all — bulk flip every DTU owned by caller.
  // Body: { consented: boolean }
  router.post("/dtus/consent-all", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const consented = req.body?.consented !== false; // default true unless explicit false
    const result = setAllDtusTrainConsent(db, userId, consented);
    res.json(result);
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
