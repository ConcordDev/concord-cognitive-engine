// server/lib/building-salvage.js
//
// G3 — destruction -> salvage (Just Cause / Far Cry). A building already collapses
// under sustained combat (applyStructuralStress: standing->damaged->collapsed). This
// turns the rubble into a resource: a collapsed building spawns a scrap
// world_resource_nodes row at its position, the material + volume scaled by what the
// building was made of. Idempotent (deterministic node id per building), so a
// re-collapse never duplicates; the node respawns on the normal gather cadence so
// the ruin keeps yielding a little. Kill-switch CONCORD_SALVAGE=0.

import crypto from "node:crypto";

// material -> the scrap it yields when the structure comes down.
const MATERIAL_SCRAP = Object.freeze({
  steel: { resourceId: "scrap_metal", resourceName: "Steel Scrap", quantity: 40, quality: 3 },
  brick: { resourceId: "stone",       resourceName: "Broken Brick", quantity: 30, quality: 1 },
  stone: { resourceId: "stone",       resourceName: "Rubble Stone", quantity: 30, quality: 1 },
  wood:  { resourceId: "wood",        resourceName: "Splintered Wood", quantity: 25, quality: 1 },
  thatch:{ resourceId: "fiber",       resourceName: "Salvaged Thatch", quantity: 15, quality: 1 },
});
const DEFAULT_SCRAP = { resourceId: "scrap_metal", resourceName: "Scrap", quantity: 20, quality: 1 };
const RESPAWN_HOURS = Number(process.env.CONCORD_SALVAGE_RESPAWN_HOURS ?? 24);

export function salvageEnabled() {
  return process.env.CONCORD_SALVAGE !== "0";
}

/**
 * Spawn the scrap node for a building that has just collapsed. No-op when
 * disabled, the building isn't actually collapsed, or the scrap node already
 * exists (deterministic id). Returns { ok, nodeId, resource } or { ok:false }.
 */
export function spawnSalvageOnCollapse(db, worldId, buildingId) {
  if (!db || !buildingId || !salvageEnabled()) return { ok: false, reason: "disabled_or_missing" };
  let b;
  try {
    b = db.prepare("SELECT world_id, building_type, material, state, x, z, biome FROM world_buildings WHERE id = ?").get(String(buildingId));
  } catch {
    // older schema may lack biome — retry without it
    try { b = db.prepare("SELECT world_id, building_type, material, state, x, z FROM world_buildings WHERE id = ?").get(String(buildingId)); }
    catch { return { ok: false, reason: "no_building" }; }
  }
  if (!b) return { ok: false, reason: "no_building" };
  if (worldId && b.world_id && b.world_id !== worldId) return { ok: false, reason: "wrong_world" };
  if (b.state !== "collapsed") return { ok: false, reason: "not_collapsed" };

  const scrap = MATERIAL_SCRAP[b.material] || DEFAULT_SCRAP;
  const nodeId = `salvage_${buildingId}`; // deterministic → idempotent
  const wid = b.world_id || worldId;
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO world_resource_nodes
        (id, world_id, node_type, resource_id, resource_name, biome,
         x, y, z, depth, quantity_remaining, max_quantity, quality, difficulty, respawn_hours, seeded)
      VALUES (?, ?, 'scrap', ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, 1, ?, 0)
    `).run(
      nodeId, wid, scrap.resourceId, scrap.resourceName, b.biome || "plains",
      Number(b.x) || 0, Number(b.z) || 0,
      scrap.quantity, scrap.quantity, scrap.quality, RESPAWN_HOURS,
    );
    if (r.changes === 0) return { ok: false, reason: "already_salvageable", nodeId };
    return { ok: true, nodeId, resource: scrap.resourceId, quantity: scrap.quantity };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export const _testing = { MATERIAL_SCRAP, DEFAULT_SCRAP };
