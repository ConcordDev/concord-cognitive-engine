// server/routes/hybrid-creatures.js
//
// GET /api/worlds/:worldId/hybrids
//   Returns every alive hybrid creature in the world with its full 3D
//   blueprint embedded so the frontend renderer can build the procedural
//   mesh without an extra round-trip per creature.
//
// Public read — the existence + position + topology of a hybrid is no more
// sensitive than a regular NPC. Auth is still threaded through if present
// (so the route plays nice with the three-gate middleware), but a missing
// session doesn't fail the call.

import express from "express";

export default function createHybridCreaturesRouter({ db }) {
  const router = express.Router();

  router.get("/:worldId/hybrids", (req, res) => {
    const worldId = req.params.worldId;
    if (!worldId) return res.status(400).json({ ok: false, error: "missing_world_id" });

    let rows = [];
    try {
      rows = db.prepare(`
        SELECT id, world_id, x, y, z, blueprint_json, parent_a, parent_b,
               generation, stability, cross_world, created_at
        FROM world_hybrid_creatures
        WHERE world_id = ? AND alive = 1
        ORDER BY created_at DESC
        LIMIT 200
      `).all(worldId);
    } catch (e) {
      // Table missing on a fresh DB — return empty array, not error.
      return res.json({ ok: true, worldId, hybrids: [] });
    }

    const hybrids = rows.map((r) => {
      let blueprint = null;
      try { blueprint = JSON.parse(r.blueprint_json); } catch { /* malformed */ }
      return {
        id: r.id,
        worldId: r.world_id,
        position: { x: r.x, y: r.y, z: r.z },
        parents: [r.parent_a, r.parent_b],
        generation: r.generation,
        stability: r.stability,
        crossWorld: !!r.cross_world,
        createdAt: r.created_at,
        blueprint,
      };
    });

    return res.json({ ok: true, worldId, hybrids });
  });

  return router;
}
