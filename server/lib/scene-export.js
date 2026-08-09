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
//
// Additive (master-spec A3+A4 — purposeful buildings): each node's `extras`
// also gains `purpose`/`district_id`/`lens`/`levels` when the node's
// `building_type` resolves unambiguously in the authored city-layout
// (server/lib/building-purpose.js#buildingPurposeForType). Only concordia-hub
// has an authored layout today; any other world — or any building_type the
// layout doesn't know about — keeps the pre-existing `extras` shape
// unchanged (no fabricated purpose, ever).
//
// Additive (master-spec C11/C12 — aerial mounts + aircraft/hover landing
// pads): `exportScene`'s result also carries a `landingPads` array — the
// real, standalone touch-down markers authored in city-layout.json's
// `landingPads` array (server/lib/building-purpose.js#landingPadsForWorld),
// so a Godot/Three.js client can render real pad locations for flight-
// capable mounts (and any future aircraft) to land at. Same honesty
// contract as `plaza` below: a world with no authored pads (every world
// other than concordia-hub today) gets an honest empty array, never
// fabricated geometry.
//
// Additive (F25 — district streaming policy): each entry of the `districts`
// array also gains `buildingCount` (real count of this world's ACTUAL
// `world_buildings` rows whose (x,z) falls inside the district's real
// boundary polygon, via `pointInPolygon` — the same geometric test
// `districtAt` uses) and `areaM2` (the district's real shoelace-formula
// polygon area, `polygonArea`). This is what lets a client (Godot's
// `world/district_streaming_policy.gd`) tune chunk-streaming density
// per-district from REAL authored data instead of a uniform constant — a
// dense district (many buildings packed into its footprint) gets a wider
// load radius than a sparse one. `densityPerM2` is deliberately NOT
// pre-computed here: `round()` below truncates to 3 decimals, which would
// silently zero out a ratio this small (~0.0002-0.0006/m²) — shipping the
// two whole, precise inputs is more honest than a lossily-rounded ratio.
// A district row is mutated in place (each call to `listDistricts` returns
// freshly-parsed objects, never shared/cached state, so this never leaks
// across requests).

import { listDistricts, pointInPolygon, polygonArea } from "./districts.js";
import { buildingPurposeForType, landingPadsForWorld } from "./building-purpose.js";
import { scatterVegetationForWorld } from "./vegetation-scatter.js";

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
    const extras = { state: r.state || "standing", floors: r.floors || 1, health: round(r.health_pct ?? 1) };
    // Never throws, never fabricates — a miss just leaves extras unchanged.
    let purposeInfo = null;
    try {
      purposeInfo = buildingPurposeForType(r.building_type, worldId);
    } catch { purposeInfo = null; }
    if (purposeInfo) {
      extras.purpose = purposeInfo.purpose;
      extras.district_id = purposeInfo.district_id;
      extras.lens = purposeInfo.lens;
      extras.levels = purposeInfo.levels;
    }
    return {
      id: r.id,
      type: r.building_type,
      name: r.name || null,
      material: r.material || "stone",
      // glTF-style transform: Y-up, rotation about Y in radians, scale = footprint.
      transform: { translation: [round(x), round(y), round(z)], rotationY: round(r.rotation || 0), scale: [round(w), round(h), round(d)] },
      extras,
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

  // F25 — real per-district building density (see header comment above).
  // Never fails the scene export: a computation error just leaves every
  // district's buildingCount/areaM2 at the honest default (0), same
  // degrade-gracefully posture as `districts`/`plaza`/`landingPads`.
  try {
    for (const d of districts) {
      d.areaM2 = Math.round(polygonArea(d.boundary));
      d.buildingCount = 0;
    }
    for (const r of visible) {
      const x = Number(r.x) || 0, z = Number(r.z) || 0;
      for (const d of districts) {
        if (pointInPolygon(x, z, d.boundary)) { d.buildingCount++; break; }
      }
    }
  } catch {
    for (const d of districts) {
      if (typeof d.areaM2 !== "number") d.areaM2 = 0;
      if (typeof d.buildingCount !== "number") d.buildingCount = 0;
    }
  }

  // Additive (master-spec A1 — Central Plaza system): identify the recorded
  // "plaza" district, if this world has one, and its real polygon centroid —
  // the orientation point a client can jump to without a second round-trip.
  // Only the district literally seeded with key "plaza" (districts.js
  // DEFAULT_DISTRICTS — id `${worldId}:plaza`) qualifies. A world with no
  // recorded plaza district (including any world other than concordia-hub
  // today) gets an honest `null`, never a guessed center. The full
  // district+building directory (names, palettes, authored purposes) lives
  // behind the separate `scenebridge.map` macro — this field is deliberately
  // just a locator, so every scene fetch doesn't have to carry the whole
  // directory payload.
  let plaza = null;
  try {
    const plazaDistrict = districts.find((d) => d.id === `${worldId}:plaza`);
    if (plazaDistrict && Array.isArray(plazaDistrict.boundary) && plazaDistrict.boundary.length >= 3) {
      const cx = plazaDistrict.boundary.reduce((s, v) => s + (Number(v.x) || 0), 0) / plazaDistrict.boundary.length;
      const cz = plazaDistrict.boundary.reduce((s, v) => s + (Number(v.z) || 0), 0) / plazaDistrict.boundary.length;
      plaza = {
        districtId: plazaDistrict.id,
        name: plazaDistrict.name,
        position: [round(cx), round(plazaDistrict.elevationHint || 0), round(cz)],
      };
    }
  } catch {
    plaza = null;
  }

  // Additive field — real landing-pad markers for this world, or [] if none
  // are authored. Never fails the scene export: a lookup error degrades to
  // [], same pattern as `districts`/`plaza` above.
  let landingPads = [];
  try {
    landingPads = landingPadsForWorld(worldId);
  } catch {
    landingPads = [];
  }

  // Additive field (Phase M2 — Godot vegetation instancing) — real,
  // deterministic vegetation placements scattered within this world's real
  // district boundary polygons (server/lib/vegetation-scatter.js), or []
  // for a world with no recorded districts (every world but concordia-hub
  // today). Never fails the scene export: a scatter error degrades to [],
  // same pattern as districts/plaza/landingPads above.
  let vegetation = [];
  try {
    vegetation = scatterVegetationForWorld(db, worldId);
  } catch {
    vegetation = [];
  }

  return { ok: true, format: SCENE_FORMAT, worldId, nodes, bounds, count: nodes.length, districts, plaza, landingPads, vegetation };
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
