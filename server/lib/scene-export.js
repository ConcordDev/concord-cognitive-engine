import { enrichScene } from "./scene-asset-enricher.js";
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

// v2: exportScene() below unconditionally routes its result through
// scene-asset-enricher.js#enrichScene (per-client hints, asset URLs,
// portals, unity assets), which stamps its own output `format:
// 'concord-scene/v2'` — this constant must agree with that real,
// always-on behavior rather than describe the pre-enrichment shape.
export const SCENE_FORMAT = "concord-scene/v2";

/** Hub world that owns the Unburned Court + Ring of Doors tableau. */
export const HUB_WORLD_ID = "concordia-hub";

/**
 * Godot client scene path for the authored Three Pillars / Ring of Doors hub
 * level (world-lens-godot/scenes/concordia-hub.tscn). Surfaced on exportScene
 * so a Godot client can load()/instance() it without the server fabricating
 * mesh bytes — the .tscn is the source of truth.
 */
export const HUB_SCENE_PATH = "res://scenes/concordia-hub.tscn";

/**
 * Child tableau path (also shipped under server/godot/scenes/ for non-client
 * tooling). The hub level instances this as a child; exportScene names it so
 * consumers that only want the triangle can load it directly.
 */
export const THREE_PILLARS_SCENE_PATH = "res://scenes/concordia-three-pillars.tscn";

/**
 * The eight Concord Link gates on the Ring of Doors (LORE_BIBLE section 4).
 * Order is stable and clockwise starting at +Z (north), matching the hub
 * .tscn embassy placeholders. Sere is intentionally absent — extra-canonical.
 */
export const RING_OF_DOORS_WORLD_IDS = Object.freeze([
  "fantasy",
  "cyber",
  "crime",
  "superhero",
  "tunya",
  "concord-link-frontier",
  "lattice-crucible",
  "sovereign-ruins",
]);

const round = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

/**
 * Author the Unburned Court + Ring of Doors + Three Pillars as concord-scene/v1
 * nodes for concordia-hub. Pure function of worldId — no DB, never fabricates
 * nodes for any other world (returns []). Canon layout (LORE_BIBLE section 1):
 *   - Unburned Court ring on XZ, radius 5.2
 *   - Three Pillars equilateral triangle inside the ring
 *   - Eight embassy placeholders on a wider Ring of Doors (radius 14)
 * Ground is a marker only — the hub ground refuses violence; clients MUST NOT
 * put combat colliders on it (see concordia-hub.tscn).
 */
export function hubTableauNodes(worldId) {
  if (worldId !== HUB_WORLD_ID) return [];

  const nodes = [];

  // Court ground — visual/marker only. extras.noCombatCollider is the contract
  // the Godot hub scene honors (StaticBody omitted on this mesh).
  nodes.push({
    id: "hub:unburned-court-ground",
    type: "unburned_court_ground",
    name: "Unburned Court",
    material: "living_soil",
    transform: {
      translation: [0, -0.04, 0],
      rotationY: 0,
      scale: [16, 0.08, 16],
    },
    extras: {
      state: "standing",
      floors: 1,
      health: 1,
      purpose: "The ground that is Concordia — refuses violence",
      noCombatCollider: true,
      hubFeature: "unburned_court",
    },
  });

  nodes.push({
    id: "hub:unburned-court-ring",
    type: "unburned_court_ring",
    name: "Unburned Court Ring",
    material: "gold_bronze",
    transform: {
      translation: [0, 0.01, 0],
      rotationY: 0,
      scale: [10.4, 0.04, 10.4],
    },
    extras: {
      state: "standing",
      floors: 1,
      health: 1,
      purpose: "Ring marking the Unburned Court",
      noCombatCollider: true,
      hubFeature: "unburned_court_ring",
      radius: 5.2,
    },
  });

  // Three Pillars — positions match server/godot/scenes/concordia-three-pillars.tscn
  // and LORE_BIBLE section 1. rotationY aims each figure per Godot -Z look convention.
  const pillars = [
    {
      id: "hub:pillar-concordia",
      godId: "concordia",
      name: "Concordia — First Breath",
      material: "warm_brown",
      translation: [0, 0, 2.887],
      rotationY: Math.PI / 2,
      title: "The First Breath",
      temperament: "warm_reckless_abundant",
    },
    {
      id: "hub:pillar-concord",
      godId: "concord",
      name: "Concord — First Law",
      material: "cold_blue",
      translation: [-2.5, 0, -1.443],
      rotationY: Math.PI / 6,
      title: "The First Law",
      temperament: "cold_analytical_obsessive",
    },
    {
      id: "hub:pillar-sovereign",
      godId: "the_sovereign",
      name: "The Sovereign — First Refusal",
      material: "void_dark",
      translation: [2.5, 0, -1.443],
      rotationY: -Math.PI / 2,
      title: "The First Refusal",
      temperament: "asshole_with_one_soft_spot",
    },
  ];

  for (const p of pillars) {
    nodes.push({
      id: p.id,
      type: "three_pillars_figure",
      name: p.name,
      material: p.material,
      transform: {
        translation: [round(p.translation[0]), round(p.translation[1]), round(p.translation[2])],
        rotationY: round(p.rotationY),
        scale: [0.7, 1.8, 0.7],
      },
      extras: {
        state: "standing",
        floors: 1,
        health: 1,
        purpose: p.title,
        hubFeature: "three_pillars",
        godId: p.godId,
        title: p.title,
        temperament: p.temperament,
        noCombatCollider: true,
        scenePath: THREE_PILLARS_SCENE_PATH,
      },
    });
  }

  // Ring of Doors — eight embassy placeholders, clockwise from +Z (north).
  const ringRadius = 14;
  for (let i = 0; i < RING_OF_DOORS_WORLD_IDS.length; i++) {
    const world = RING_OF_DOORS_WORLD_IDS[i];
    const angle = (i / RING_OF_DOORS_WORLD_IDS.length) * Math.PI * 2;
    // +Z north at i=0; clockwise in XZ (x = sin, z = cos)
    const x = Math.sin(angle) * ringRadius;
    const z = Math.cos(angle) * ringRadius;
    // Face inward toward court center: yaw so -Z points toward origin.
    const rotationY = Math.atan2(-x, -z);
    nodes.push({
      id: `hub:embassy-${world}`,
      type: "ring_of_doors_embassy",
      name: `Embassy — ${world}`,
      material: "gate_stone",
      transform: {
        translation: [round(x), 0, round(z)],
        rotationY: round(rotationY),
        scale: [3, 4, 2],
      },
      extras: {
        state: "standing",
        floors: 1,
        health: 1,
        purpose: `Ring of Doors embassy gate for ${world}`,
        hubFeature: "ring_of_doors",
        targetWorldId: world,
        noCombatCollider: true,
      },
    });
  }

  return nodes;
}

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

  let bounds = nodes.length
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

  // Additive (audit v4 proposal #3) — Unburned Court / Three Pillars / Ring of
  // Doors tableau for concordia-hub only. Concatenated onto building nodes so
  // existing consumers keep working; empty for every other world.
  let hubNodes = [];
  try {
    hubNodes = hubTableauNodes(worldId);
  } catch {
    hubNodes = [];
  }
  if (hubNodes.length) {
    nodes.push(...hubNodes);
    // Expand bounds to include hub tableau if buildings alone were empty/narrow.
    let minX = bounds ? bounds.min[0] : Infinity;
    let maxX = bounds ? bounds.max[0] : -Infinity;
    let minZ = bounds ? bounds.min[2] : Infinity;
    let maxZ = bounds ? bounds.max[2] : -Infinity;
    let maxY = bounds ? bounds.max[1] : 0;
    for (const n of hubNodes) {
      const t = n.transform?.translation || [0, 0, 0];
      const s = n.transform?.scale || [1, 1, 1];
      const x = Number(t[0]) || 0, y = Number(t[1]) || 0, z = Number(t[2]) || 0;
      const w = Number(s[0]) || 1, h = Number(s[1]) || 1, d = Number(s[2]) || 1;
      if (x - w / 2 < minX) minX = x - w / 2;
      if (x + w / 2 > maxX) maxX = x + w / 2;
      if (z - d / 2 < minZ) minZ = z - d / 2;
      if (z + d / 2 > maxZ) maxZ = z + d / 2;
      if (y + h > maxY) maxY = y + h;
    }
    bounds = {
      min: [round(minX), 0, round(minZ)],
      max: [round(maxX), round(maxY), round(maxZ)],
    };
  }

  const result = {
    ok: true,
    format: SCENE_FORMAT,
    worldId,
    nodes,
    bounds,
    count: nodes.length,
    districts,
    plaza,
    landingPads,
    vegetation,
  };

  // Godot scenePath hint — only for the hub, where an authored .tscn exists.
  // Clients that understand it can instance the real tableau; others ignore.
  if (worldId === HUB_WORLD_ID) {
    result.scenePath = HUB_SCENE_PATH;
    result.tableauScenePath = THREE_PILLARS_SCENE_PATH;
  }

  // Hybrid client enrichment: combat styles, asset URLs, soundscape, etc.
  // This adds 3-client descriptor (Three.js + Godot + Unity) to every scene
  // export. Wrapped in try/catch so a missing/wrong module doesn't break
  // existing scene export behavior.
  try {
    const enriched = enrichScene(result, worldId);
    return enriched;
  } catch {
    return result;
  }
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

export default {
  exportScene,
  sceneStats,
  SCENE_FORMAT,
  HUB_WORLD_ID,
  HUB_SCENE_PATH,
  THREE_PILLARS_SCENE_PATH,
  RING_OF_DOORS_WORLD_IDS,
  hubTableauNodes,
};
