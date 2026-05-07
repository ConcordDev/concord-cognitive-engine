// server/routes/companions.js
//
// REST surface for the companion (pet/tame) system. The actual tame
// success roll lives in lib/companions.js so it's exercisable from
// tests + the heartbeat tick (auto-tame from extreme bond) without
// going through HTTP.

import { Router } from "express";
import {
  attemptTame,
  deployCompanion,
  dismissCompanion,
  renameCompanion,
  listCompanions,
  TAME_BOND_THRESHOLD,
} from "../lib/companions.js";
import { getBond } from "../lib/creature-crossbreeding.js";

export default function createCompanionsRouter({ requireAuth, db, realtimeEmit }) {
  const router = Router();

  // GET /api/companions?worldId=…
  router.get("/", requireAuth, (req, res) => {
    try {
      const worldId = req.query.worldId ? String(req.query.worldId) : null;
      const rows = listCompanions(db, req.user.id, { worldId });
      res.json({ ok: true, companions: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/companions/tame-attempt
  // body: { creatureId, creatureName?, worldId?, lureItem?, tameSkill? }
  router.post("/tame-attempt", requireAuth, (req, res) => {
    try {
      const { creatureId, creatureName, worldId, lureItem, tameSkill } = req.body || {};
      if (!creatureId) return res.status(400).json({ ok: false, error: "creatureId_required" });
      const result = attemptTame(db, {
        ownerId: req.user.id,
        creatureId: String(creatureId).slice(0, 80),
        creatureName: creatureName ? String(creatureName).slice(0, 60) : "Companion",
        worldId: worldId ? String(worldId).slice(0, 64) : "concordia-hub",
        lureItem: lureItem || null,
        tameSkill: Math.max(0, Math.min(200, Number(tameSkill) || 0)),
      });
      if (result.ok && realtimeEmit) {
        try {
          realtimeEmit("companion:tame-success", {
            ownerId: req.user.id,
            companionId: result.companionId,
            creatureId,
            name: creatureName || "Companion",
          });
        } catch { /* best-effort */ }
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/companions/:id/deploy
  router.post("/:id/deploy", requireAuth, (req, res) => {
    try {
      const worldId = req.body?.worldId ? String(req.body.worldId) : "concordia-hub";
      const result = deployCompanion(db, req.user.id, req.params.id, worldId);
      if (result.ok && realtimeEmit) {
        try {
          realtimeEmit("companion:deployed", {
            ownerId: req.user.id, companionId: req.params.id, worldId,
          });
        } catch { /* best-effort */ }
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/companions/:id/dismiss
  router.post("/:id/dismiss", requireAuth, (req, res) => {
    try {
      const result = dismissCompanion(db, req.user.id, req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/companions/:id/rename
  router.post("/:id/rename", requireAuth, (req, res) => {
    try {
      const result = renameCompanion(db, req.user.id, req.params.id, req.body?.name);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/companions/bond?creatureId=…
  // Returns current bond level + tame threshold for the (caller, creature)
  // pair. The frontend overlay uses this to show progress toward tameable.
  router.get("/bond", requireAuth, (req, res) => {
    try {
      const creatureId = req.query?.creatureId ? String(req.query.creatureId) : null;
      if (!creatureId) return res.status(400).json({ ok: false, error: "creatureId_required" });
      // getBond returns a numeric scalar from creature-crossbreeding.
      const bond = Number(getBond(db, req.user.id, creatureId)) || 0;
      res.json({ ok: true, bond, threshold: TAME_BOND_THRESHOLD });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
