// server/routes/companions-breeding.js
//
// Wave 2 / T1.3 — REST surface for player taming + breeding.
//
//   POST /api/companions/tame             { creatureId, name? }
//   POST /api/companions/breed            { aId, bId, name? }
//   GET  /api/companions/tame-chance/:id  → { chance, bond }
//   GET  /api/companions/mine             → list owned companions
//
// Auth required. Persistence happens via lib/taming.js.

import express from "express";
import { attemptTame, breedCompanions, tameChance } from "../lib/taming.js";

// Mount toggle helpers. Only one companion can be mounted at a time per
// user — flipping mount on a new one auto-dismounts the previous.
function _mount(db, userId, companionId) {
  const row = db.prepare(`SELECT id, mount_eligible, world_id FROM player_companions WHERE id = ? AND owner_id = ?`).get(companionId, userId);
  if (!row) return { ok: false, reason: "companion_not_found" };
  if (row.mount_eligible === 0) return { ok: false, reason: "not_mount_eligible" };
  const tx = db.transaction(() => {
    db.prepare(`UPDATE player_companions SET mounted = 0 WHERE owner_id = ? AND mounted = 1`).run(userId);
    db.prepare(`UPDATE player_companions SET mounted = 1, deployed = 1 WHERE id = ?`).run(companionId);
  });
  tx();
  return { ok: true, companionId, worldId: row.world_id };
}

function _dismount(db, userId) {
  const r = db.prepare(`UPDATE player_companions SET mounted = 0 WHERE owner_id = ? AND mounted = 1`).run(userId);
  return { ok: true, dismounted: r.changes };
}

export default function createCompanionsBreedingRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/mine", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    try {
      const rows = db.prepare(`
        SELECT id, creature_id, name, tame_bond, loyalty, level, xp, world_id,
               deployed, blueprint_json, source_kind, caught_at
        FROM player_companions WHERE owner_id = ? ORDER BY caught_at DESC LIMIT 100
      `).all(userId);
      const companions = rows.map((r) => ({
        ...r,
        blueprint: r.blueprint_json ? _tryParseJSON(r.blueprint_json) : null,
      }));
      return res.json({ ok: true, companions });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.get("/tame-chance/:creatureId", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const creatureId = req.params.creatureId;
    if (!creatureId) return res.status(400).json({ ok: false, error: "missing_creature_id" });
    try {
      const chance = tameChance(db, userId, creatureId);
      const bondRow = db.prepare(`
        SELECT bond FROM creature_bonds
        WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)
      `).get(userId, creatureId, creatureId, userId);
      return res.json({ ok: true, chance, bond: bondRow?.bond ?? 0 });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.post("/tame", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { creatureId, name } = req.body || {};
    if (!creatureId) return res.status(400).json({ ok: false, error: "missing_creature_id" });
    const result = attemptTame(db, userId, creatureId, { name });
    if (!result.ok) return res.status(400).json(result);
    if (result.success && result.companion) {
      try {
        req.app.locals.io?.to(`world:${result.companion.worldId}`)?.emit?.("world:companion-tamed", {
          worldId: result.companion.worldId,
          ownerId: userId,
          companionId: result.companion.id,
          creatureId: result.companion.creatureId,
        });
      } catch { /* realtime best-effort */ }
    }
    return res.json(result);
  });

  router.post("/:companionId/mount", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const r = _mount(db, userId, req.params.companionId);
    if (!r.ok) return res.status(400).json(r);
    try {
      req.app.locals.io?.to(`world:${r.worldId}`)?.emit?.("world:player-mounted", {
        worldId: r.worldId, ownerId: userId, companionId: r.companionId,
      });
    } catch { /* realtime best-effort */ }
    return res.json(r);
  });

  router.post("/dismount", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const r = _dismount(db, userId);
    try {
      req.app.locals.io?.to(`user:${userId}`)?.emit?.("world:player-dismounted", { ownerId: userId });
    } catch { /* realtime best-effort */ }
    return res.json(r);
  });

  router.post("/breed", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { aId, bId, name } = req.body || {};
    if (!aId || !bId) return res.status(400).json({ ok: false, error: "missing_companion_ids" });
    const result = await breedCompanions(db, userId, aId, bId, { name });
    if (!result.ok) return res.status(400).json(result);
    try {
      const worldId = result.companion?.worldId;
      if (worldId) {
        req.app.locals.io?.to(`world:${worldId}`)?.emit?.("world:companion-bred", {
          worldId,
          ownerId: userId,
          companionId: result.companion.id,
          hybridId: result.hybrid.hybridId,
        });
      }
    } catch { /* realtime best-effort */ }
    return res.json(result);
  });

  return router;
}

function _tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
