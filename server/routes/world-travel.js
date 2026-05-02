// server/routes/world-travel.js
// World-travel endpoints. Mounted at /api/world-travel.
//
//   GET   /worlds            — list every registered world (public read)
//   GET   /me                — auth'd user's current world + recent travel log
//   POST  /travel            — auth'd: { toWorld, anchorId? } → updates current_world
//
// The Concord Link's /send route reads users.current_world to validate that
// the sourceWorld matches where the user actually is. Travel is the only
// route that updates that column.

import { Router } from "express";
import {
  getCurrentWorld,
  travelTo,
  listAvailableWorlds,
  listRecentTravel,
} from "../lib/world-travel.js";

export default function createWorldTravelRouter({ requireAuth, db, emitToUser }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  router.get("/worlds", (_req, res) => {
    try {
      res.json({ ok: true, worlds: listAvailableWorlds() });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.get("/me", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const currentWorld = getCurrentWorld(db, userId);
      const recent = listRecentTravel(db, userId, { limit: 10 });
      res.json({ ok: true, currentWorld, recent });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/travel", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { toWorld, anchorId = null } = req.body || {};
      if (!toWorld) {
        return res.status(400).json({ ok: false, error: "toWorld required" });
      }
      const result = travelTo(db, userId, String(toWorld), { anchorId: anchorId ? String(anchorId) : null });
      if (!result.ok) {
        const status = result.reason === "unknown_world" || result.reason === "anchor_mismatch" ? 400 : 500;
        return res.status(status).json(result);
      }

      if (emitToUser) {
        try { emitToUser(userId, "world:traveled", { fromWorld: result.fromWorld, toWorld: result.toWorld, travelId: result.travelId }); }
        catch { /* realtime best-effort */ }
      }

      res.status(200).json(result);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
