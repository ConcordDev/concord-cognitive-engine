// server/lib/districts.js
//
// Districts as real 2D geometric regions with identity (migration 374).
//
// Before this, "district" existed only as a bare `district_id TEXT` tag
// carried across many tables (city_presence, ambient_chat, friend-presence,
// ...) with no boundary geometry and no visual identity behind it — and
// `city-manager.js`'s in-memory `districts` array was just a JSON list, not
// a queryable region. This module is the geometric source of truth: CRUD +
// query helpers over the `districts` table, plus a pure point-in-polygon
// query so callers (scene export, Godot-side rendering, gameplay systems)
// can ask "which district is this point in" honestly, from real recorded
// boundaries — never guessed or interpolated.
//
// Exports:
//   pointInPolygon(x, z, polygon)      — pure ray-cast point-in-polygon test
//   seedDefaultDistricts(db, worldId)  — idempotent authored seed
//   listDistricts(db, worldId)         — all districts for a world
//   getDistrict(db, id)                — single district by id
//   districtAt(db, worldId, x, z)      — first district whose boundary
//                                         contains (x, z), or null

const EPS = 1e-6;

/**
 * Is (x, z) on the closed line segment a→b (inclusive of endpoints)?
 * Used so boundary edges count as "inside" the district — a player standing
 * exactly on a district line shouldn't be silently unassigned.
 */
function isOnSegment(x, z, a, b, eps = EPS) {
  const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
  if (Math.abs(cross) > eps) return false;
  const dot = (x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z);
  if (dot < -eps) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  if (dot > lenSq + eps) return false;
  return true;
}

/**
 * Standard ray-casting point-in-polygon test over a polygon given as an
 * array of {x, z} vertices (at least 3). Pure function — no DB, no state.
 * Boundary points (on any edge) are treated as inside.
 *
 * @param {number} x
 * @param {number} z
 * @param {Array<{x:number,z:number}>} polygon
 * @returns {boolean}
 */
/**
 * Shoelace-formula polygon area (always non-negative — orientation-agnostic).
 * Pure. Used for real per-district building-density computation (F25 —
 * district streaming policy); a malformed polygon (<3 vertices, or a vertex
 * missing x/z) honestly returns 0 rather than a guessed area.
 * @param {Array<{x:number,z:number}>} polygon
 * @returns {number}
 */
export function polygonArea(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b || typeof a.x !== "number" || typeof a.z !== "number" || typeof b.x !== "number" || typeof b.z !== "number") {
      return 0;
    }
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(x, z, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b || typeof a.x !== "number" || typeof a.z !== "number") continue;
    if (isOnSegment(x, z, a, b)) return true;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    const intersect =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Rectangle helper: 4 corner vertices (CCW), given center + half-extents. */
function rect(cx, cz, halfW, halfD) {
  return [
    { x: cx - halfW, z: cz - halfD },
    { x: cx + halfW, z: cz - halfD },
    { x: cx + halfW, z: cz + halfD },
    { x: cx - halfW, z: cz + halfD },
  ];
}

// Authored default layout for concordia-hub — a simple non-overlapping grid
// of six districts around the origin, at a scale consistent with the
// authored world_zones (content/world/concordia-hub/zones.json spans
// roughly x∈[-240,280], z∈[-240,90]). Palettes + lighting tags are chosen
// for visual legibility (Godot Phase 2's stated need), not gameplay effect.
const DEFAULT_DISTRICTS = [
  {
    key: "plaza",
    name: "The Concord Plaza",
    boundary: rect(0, 0, 70, 70),
    palette: { primary: "#d9c9a3", secondary: "#8b7355", accent: "#f2c14e" },
    lightingTag: "warm_day",
    elevationHint: 0,
  },
  {
    key: "market",
    name: "The Lantern Market",
    boundary: rect(170, 0, 80, 70),
    palette: { primary: "#c1440e", secondary: "#f4a300", accent: "#2a9d8f" },
    lightingTag: "market_bright",
    elevationHint: 0,
  },
  {
    key: "academy",
    name: "The Concordance Academy",
    boundary: rect(0, 170, 70, 80),
    palette: { primary: "#3a4a7a", secondary: "#6c5b7b", accent: "#c9a0dc" },
    lightingTag: "academy_dusk",
    elevationHint: 2,
  },
  {
    key: "observatory",
    name: "The Sundered Observatory",
    boundary: rect(-170, 0, 80, 70),
    palette: { primary: "#1b1f3b", secondary: "#2e3651", accent: "#e0c3fc" },
    lightingTag: "night_glow",
    elevationHint: 18,
  },
  {
    key: "riverside",
    name: "Riverside Commons",
    boundary: rect(0, -170, 70, 80),
    palette: { primary: "#2f6f4e", secondary: "#7fb685", accent: "#a7d7c5" },
    lightingTag: "overcast_soft",
    elevationHint: -2,
  },
  {
    key: "industrial",
    name: "The Foundry Row",
    boundary: rect(170, -170, 80, 80),
    palette: { primary: "#5c5c5c", secondary: "#8a6d3b", accent: "#d9534f" },
    lightingTag: "hazy_industrial",
    elevationHint: 0,
  },
];

/**
 * Seed the authored default district set for a world (idempotent — safe to
 * call on every boot; only inserts districts that don't already exist by
 * id). Currently only concordia-hub has an authored layout; other worlds
 * get a no-op (empty districts is honest — never fabricate geometry for a
 * world nobody has designed).
 *
 * @param {object} db
 * @param {string} worldId
 * @returns {{ok:boolean, seeded:number, skipped?:number, reason?:string}}
 */
export function seedDefaultDistricts(db, worldId) {
  if (!db) return { ok: false, seeded: 0, reason: "missing_db" };
  if (!worldId) return { ok: false, seeded: 0, reason: "missing_world" };

  if (worldId !== "concordia-hub") {
    return { ok: true, seeded: 0, reason: "no_authored_layout_for_world" };
  }

  let seeded = 0;
  let skipped = 0;
  const insert = db.prepare(`
    INSERT INTO districts (id, world_id, name, boundary_json, palette_json, lighting_tag, elevation_hint)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const exists = db.prepare(`SELECT 1 FROM districts WHERE id = ?`);

  for (const d of DEFAULT_DISTRICTS) {
    const id = `${worldId}:${d.key}`;
    if (exists.get(id)) { skipped++; continue; }
    insert.run(
      id,
      worldId,
      d.name,
      JSON.stringify(d.boundary),
      JSON.stringify(d.palette),
      d.lightingTag,
      d.elevationHint,
    );
    seeded++;
  }

  return { ok: true, seeded, skipped };
}

function parseDistrictRow(row) {
  if (!row) return null;
  let boundary = [];
  let palette = {};
  try { boundary = JSON.parse(row.boundary_json || "[]"); } catch { boundary = []; }
  try { palette = JSON.parse(row.palette_json || "{}"); } catch { palette = {}; }
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    boundary,
    palette,
    lightingTag: row.lighting_tag || null,
    elevationHint: Number(row.elevation_hint) || 0,
    createdAt: row.created_at,
  };
}

/**
 * All districts recorded for a world, parsed (boundary/palette as objects,
 * not raw JSON strings).
 * @param {object} db
 * @param {string} worldId
 * @returns {Array<object>}
 */
export function listDistricts(db, worldId) {
  if (!db || !worldId) return [];
  let rows;
  try {
    rows = db.prepare(`SELECT * FROM districts WHERE world_id = ? ORDER BY name`).all(worldId);
  } catch {
    return [];
  }
  return rows.map(parseDistrictRow);
}

/**
 * A single district by id, parsed.
 * @param {object} db
 * @param {string} id
 * @returns {object|null}
 */
export function getDistrict(db, id) {
  if (!db || !id) return null;
  let row;
  try {
    row = db.prepare(`SELECT * FROM districts WHERE id = ?`).get(id);
  } catch {
    return null;
  }
  return parseDistrictRow(row);
}

/**
 * The first district in `worldId` whose boundary polygon contains (x, z),
 * or null if the point falls outside every recorded district (honest — a
 * point outside all authored geometry has no district, it is never guessed).
 * @param {object} db
 * @param {string} worldId
 * @param {number} x
 * @param {number} z
 * @returns {object|null}
 */
export function districtAt(db, worldId, x, z) {
  const districts = listDistricts(db, worldId);
  for (const d of districts) {
    if (pointInPolygon(x, z, d.boundary)) return d;
  }
  return null;
}

export default { pointInPolygon, polygonArea, seedDefaultDistricts, listDistricts, getDistrict, districtAt };
