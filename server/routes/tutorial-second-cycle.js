// server/routes/tutorial-second-cycle.js
//
// Wave 7 / T3.2 — second-cycle tutorial routes.
//   GET  /api/tutorial/second-cycle           — progress
//   POST /api/tutorial/ui-opened              — stamp a UI open
//                                                 body: { uiKey }

import express from "express";
import { deriveSecondCycleProgress, recordUiOpen, SECOND_CYCLE_STEPS } from "../lib/tutorial-second-cycle.js";

const ALLOWED_UI_KEYS = new Set([
  "character_sheet", "favorites_wheel", "perk_constellation",
  "bestiary", "settlement_editor", "compass", "hand_ready",
]);

export default function createTutorialSecondCycleRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/second-cycle", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    return res.json(deriveSecondCycleProgress(db, userId));
  });

  router.post("/ui-opened", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { uiKey } = req.body || {};
    if (!uiKey || !ALLOWED_UI_KEYS.has(uiKey)) {
      return res.status(400).json({ ok: false, error: "invalid_ui_key", allowed: [...ALLOWED_UI_KEYS] });
    }
    const r = recordUiOpen(db, userId, uiKey);
    return res.json({ ...r, progress: deriveSecondCycleProgress(db, userId) });
  });

  // Exposes the canonical step list for the UI to render labels without
  // duplicating them client-side.
  router.get("/second-cycle/steps", (_req, res) => {
    return res.json({ ok: true, steps: SECOND_CYCLE_STEPS });
  });

  return router;
}
