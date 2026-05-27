// server/routes/dungeons.js
//
// Wave F — REST surface for procedural dungeons.
//
//   GET  /api/dungeons?worldId=...            — list active dungeons
//   GET  /api/dungeons/:id                    — full dungeon shape
//   POST /api/dungeons/:id/enter/:roomIdx     — log visit + roll loot
//   POST /api/dungeons/loot/:lootId/claim     — transfer to inventory
//   POST /api/dungeons/:id/clear              — mark cleared (boss down)

import express from "express";
import { getDungeon, listInWorld, enterRoom, claimLoot } from "../lib/dungeons.js";

export default function createDungeonsRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/", requireAuth, (req, res) => {
    const worldId = String(req.query?.worldId || "concordia-hub");
    try {
      const dungeons = listInWorld(db, worldId, { limit: 50 });
      return res.json({ ok: true, worldId, dungeons });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.get("/:dungeonId", requireAuth, (req, res) => {
    const d = getDungeon(db, req.params.dungeonId);
    if (!d) return res.status(404).json({ ok: false, error: "dungeon_not_found" });
    return res.json({ ok: true, dungeon: d });
  });

  router.post("/:dungeonId/enter/:roomIdx", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const roomIdx = Number(req.params.roomIdx);
    if (!Number.isInteger(roomIdx)) return res.status(400).json({ ok: false, error: "invalid_room_idx" });
    const r = enterRoom(db, req.params.dungeonId, roomIdx, userId);
    if (!r.ok) return res.status(404).json(r);
    return res.json(r);
  });

  router.post("/loot/:lootId/claim", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    // Resolve the loot row to its world_id via dungeon lookup so the
    // claim writes the correct player_inventory.world_id.
    let worldId = null;
    try {
      const row = db.prepare(`
        SELECT d.world_id FROM dungeon_loot_instances l
        JOIN dungeons d ON d.id = l.dungeon_id
        WHERE l.id = ?
      `).get(req.params.lootId);
      worldId = row?.world_id || null;
    } catch { /* ok */ }
    const r = claimLoot(db, req.params.lootId, userId, { worldId });
    if (!r.ok) return res.status(400).json(r);
    return res.json(r);
  });

  router.post("/:dungeonId/clear", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    try {
      const d = db.prepare(`SELECT * FROM dungeons WHERE id = ?`).get(req.params.dungeonId);
      if (!d) return res.status(404).json({ ok: false, error: "dungeon_not_found" });
      // The boss room must be marked cleared OR the request includes
      // killed=true; route doesn't enforce combat, just marks state.
      db.prepare(`
        UPDATE dungeons SET status = 'cleared', cleared_at = unixepoch() WHERE id = ?
      `).run(req.params.dungeonId);
      try {
        req.app.locals.io?.to?.(`world:${d.world_id}`)?.emit?.("world:dungeon-cleared", {
          worldId: d.world_id, dungeonId: d.id, clearerUserId: userId, name: d.name,
        });
      } catch { /* ok */ }
      return res.json({ ok: true, dungeonId: req.params.dungeonId });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  return router;
}
