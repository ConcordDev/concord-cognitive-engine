// server/routes/world-doors.js
//
// Wave G6 — REST surface for door open/close.
//
//   GET  /api/world-doors?worldId=...
//   POST /api/world-doors/:doorId/open
//   POST /api/world-doors/:doorId/close

import express from "express";
import { listForWorld, openDoor, closeDoor } from "../lib/world-doors.js";

export default function createWorldDoorsRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const worldId = String(req.query?.worldId || "concordia-hub");
    const doors = listForWorld(db, worldId);
    return res.json({ ok: true, worldId, doors });
  });

  router.post("/:doorId/open", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const r = openDoor(db, { doorId: req.params.doorId });
    if (r.ok && r.worldId) {
      try {
        req.app.locals.io?.to?.(`world:${r.worldId}`)?.emit?.("door:opened", {
          worldId: r.worldId, doorId: r.doorId, userId,
        });
      } catch { /* ok */ }
    }
    if (!r.ok) return res.status(404).json(r);
    return res.json(r);
  });

  router.post("/:doorId/close", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const r = closeDoor(db, { doorId: req.params.doorId });
    if (r.ok && r.worldId) {
      try {
        req.app.locals.io?.to?.(`world:${r.worldId}`)?.emit?.("door:closed", {
          worldId: r.worldId, doorId: r.doorId, userId,
        });
      } catch { /* ok */ }
    }
    if (!r.ok) return res.status(404).json(r);
    return res.json(r);
  });

  return router;
}
