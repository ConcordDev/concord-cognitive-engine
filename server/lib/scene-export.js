// server/lib/scene-export.js
//
// Engine Bridge (#29) — serializes the REAL world geometry (world_buildings:
// position, rotation, footprint, material, state) into a neutral scene graph an
// external engine (Unreal, Godot, a Three.js client) can ingest. The format is a
// glTF-flavoured node list with translation / Y-rotation / scale + extras. This
// module only PRODUCES the data from real rows; the engine-side import is the
// documented adapter boundary — nothing here fakes an engine.
//
// Additive: `exportScene`'s result also carries a `districts` array (real
// rows from the migration-374 `districts` table, via server/lib/districts.js)
// so a consumer (Godot Phase 2 in particular) can render district regions
// for visual legibility alongside the building nodes. This is a pure
// addition — `nodes`/`bounds`/`format`/`count` are unchanged, and a world
// with no recorded districts gets an honest empty array, never fabricated
// geometry.

import { listDistricts } from "./districts.js";

export const SCENE_FORMAT = "concord-scene/v1";

const round = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

/**
 * Export a world's buildings as a scene graph.
 * @param {object} db
 * @param {string} worldId
 * @param {object} [opts] { includeCollapsed=false }
 * @returns {{ok, format, worldId, nodes, bounds, count}}
 */
export function exportScene(db, worldId, { includeCollapsed = false } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_world" };
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, building_type, name, x, y, z, rotation, width, depth, height,
             material, floors, state, health_pct
      FROM world_buildings WHERE world_id = ? ORDER BY id
    `).all(worldId);
  } catch (e) {
    return { ok: false, reason: "query_failed", error: String(e?.message || e) };
  }
  const visible = includeCollapsed ? rows : rows.filter((r) => r.state !== "collapsed");

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  const nodes = visible.map((r) => {
    const w = Number(r.width) || 1, h = Number(r.height) || 1, d = Number(r.depth) || 1;
    const x = Number(r.x) || 0, y = Number(r.y) || 0, z = Number(r.z) || 0;
    if (x - w / 2 < minX) minX = x - w / 2; if (x + w / 2 > maxX) maxX = x + w / 2;
    if (z - d / 2 < minZ) minZ = z - d / 2; if (z + d / 2 > maxZ) maxZ = z + d / 2;
    if (y + h > maxY) maxY = y + h;
    return {
      id: r.id,
      type: r.building_type,
      name: r.name || null,
      material: r.material || "stone",
      // glTF-style transform: Y-up, rotation about Y in radians, scale = footprint.
      transform: { translation: [round(x), round(y), round(z)], rotationY: round(r.rotation || 0), scale: [round(w), round(h), round(d)] },
      extras: { state: r.state || "standing", floors: r.floors || 1, health: round(r.health_pct ?? 1) },
    };
  });

  const bounds = nodes.length
    ? { min: [round(minX), 0, round(minZ)], max: [round(maxX), round(maxY), round(maxZ)] }
    : null;

  // Additive field — real district rows (boundary polygon + palette +
  // lighting identity) for this world, or [] if none are recorded. Never
  // fails the scene export: a districts-lookup error degrades to [].
  let districts = [];
  try {
    districts = listDistricts(db, worldId);
  } catch {
    districts = [];
  }

  return { ok: true, format: SCENE_FORMAT, worldId, nodes, bounds, count: nodes.length, districts };
}

/** Cheap stats without building the whole node list. */
export function sceneStats(db, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_world" };
  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?`).get(worldId).n;
    const byType = db.prepare(`SELECT building_type AS t, COUNT(*) AS n FROM world_buildings WHERE world_id = ? GROUP BY building_type`).all(worldId);
    return { ok: true, total, byType: Object.fromEntries(byType.map((r) => [r.t, r.n])) };
  } catch {
    return { ok: true, total: 0, byType: {} };
  }
}

export default { exportScene, sceneStats, SCENE_FORMAT };
