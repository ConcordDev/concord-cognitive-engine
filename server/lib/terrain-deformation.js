// server/lib/terrain-deformation.js
//
// Living Society — Phase 0.6: destructible world (server side).
//
// The world is the matter source: everything is a resource node and terrain
// physically deforms. We persist only the DELTAS over the seed-regenerated
// base heightmap (cheap + procedural; only the pits/craters/raises persist),
// so a dug pit survives reload and the heightmap stays the single elevation
// truth (killing the server sin-wave divergence for any caller that reads
// base+delta).
//
// Deterministic + pure-callable where possible so the dig + collapse math is
// node --test'able without a live world.

import crypto from "node:crypto";
import { renderedElevationAt, RENDERED_TERRAIN_CONSTANTS } from "./world-terrain.js";

export const CELL_SIZE = Number(process.env.CONCORD_TERRAIN_CELL_M) || 10; // metres per deformation cell
// Sourced from world-terrain.js's RENDERED_TERRAIN_CONSTANTS (not a local
// literal) so this module can never silently drift from the canonical
// formula's own notion of world size again.
const WORLD_SIZE = RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters; // 2000
const MAX_DIG_DEPTH = Number(process.env.CONCORD_MAX_DIG_DEPTH) || 30; // metres below base a cell can be dug
const MAX_RAISE = Number(process.env.CONCORD_MAX_RAISE) || 20;

export function cellOf(wx, wz) {
  return { cx: Math.floor(wx / CELL_SIZE), cz: Math.floor(wz / CELL_SIZE) };
}

// ── Base heightmap (the seed) ─────────────────────────────────────────────
// Delegates to world-terrain.js#renderedElevationAt — the CANONICAL port of
// TerrainRenderer.tsx#generatePoughkeepsieHeightmap (the formula the
// Three.js client actually renders). This module previously carried an
// independent sine-series APPROXIMATION of that shape (same qualitative
// river/bluff/plateau/hills/creek structure, different numeric values —
// a structural approximation, not the same function) that had silently
// diverged from the real rendered terrain; world-gathering.js (node
// elevation) and terrain-water.js (flow) both consume `baseElevation`
// directly, so that divergence was live, not theoretical. Delegating here
// makes this THE single elevation truth end-to-end: render, gathering, and
// hydrology all sample the identical formula.
//
// Coordinate convention: `nx = wx / WORLD_SIZE`, `nz = wz / WORLD_SIZE` —
// i.e. wx/wz are expected in the same [0, WORLD_SIZE] (non-centred) range
// this module always used, matching `renderedElevationAt`'s own
// documented raw-grid convention (`x/width`, NOT the centred-origin
// `sampleRenderedHeight` convenience wrapper world-terrain.js also
// exports, which offsets by size/2 to match TerrainRenderer.tsx's mesh
// *placement* math). Do NOT swap in `sampleRenderedHeight` here without
// re-deriving every caller's coordinate space — it is not a drop-in.
//
// `renderedElevationAt` already returns metres, clamped to
// [0, RENDERED_TERRAIN_CONSTANTS.maxElevation] (80) — no additional
// scaling or clamping needed; the old `Math.max(0, Math.min(80, elev))`
// clamp this function used to do itself is now performed inside
// `renderedElevationAt`.
//
// CAVEATS (documented, not fixed here — out of scope for this change):
//   - The Three.js client (`TerrainRenderer.tsx`) has its OWN in-language
//     copy of this formula (it can't import server ESM); that copy must be
//     hand-kept-in-sync with `world-terrain.js#renderedElevationAt` by
//     whoever touches either side. This file no longer contributes a THIRD
//     divergent copy, but the client/server duplication itself remains.
//   - Any world with PERSISTED deformation deltas (`world_terrain_deformations`)
//     will see a step-change in its cells' ABSOLUTE base elevation the
//     first time this runs (the old sine-series baseline vs. the real
//     rendered baseline differ at most points). Deltas are stored as
//     RELATIVE offsets (`getElevationAt` = base + delta), so a previously
//     dug pit or raised mound keeps the same offset from the new, more
//     correct base — gameplay (pit depth, mound height) is unaffected —
//     but the ABSOLUTE elevation at a deformed cell will jump to match
//     the real terrain instead of the old approximation.
export function baseElevation(wx, wz) {
  return renderedElevationAt(wx / WORLD_SIZE, wz / WORLD_SIZE);
}

/** Total delta accumulated at a cell (sum is a single row, so this is a read). */
export function deltaAt(db, worldId, cx, cz) {
  if (!db) return 0;
  try {
    const row = db.prepare(`
      SELECT height_delta FROM world_terrain_deformations
      WHERE world_id = ? AND cell_x = ? AND cell_z = ?
    `).get(worldId, cx, cz);
    return row ? Number(row.height_delta) || 0 : 0;
  } catch { return 0; }
}

/** The single elevation truth: base + persisted delta. */
export function getElevationAt(db, worldId, wx, wz) {
  const { cx, cz } = cellOf(wx, wz);
  return Math.max(0, baseElevation(wx, wz) + deltaAt(db, worldId, cx, cz));
}

// ── Terrain material by depth + biome (Phase-0 propertied) ───────────────────
// Shallow = dirt/soil; mid = clay/stone; deep = stone/ore. Returns a resource id
// that resolves through resources.js / resource_properties.
export function terrainMaterialAt(baseY, currentDepthBelowBase) {
  const d = currentDepthBelowBase;
  if (d < 2) return "soil";
  if (d < 6) return baseY > 45 ? "stone" : "clay";
  if (d < 14) return "stone";
  return "iron_ore";
}

/**
 * Apply a deformation to a cell (upsert the accumulated delta). Clamped so a
 * cell can't be dug past MAX_DIG_DEPTH or raised past MAX_RAISE. Returns the new
 * delta + the material yielded (for excavate). Deterministic.
 *
 * @param {object} db
 * @param {string} worldId
 * @param {number} wx,wz       world coords
 * @param {number} amount      metres (positive = dig down for 'excavate'/'crater', up for 'raise')
 * @param {string} kind        excavate | crater | raise
 */
export function applyDeformation(db, worldId, wx, wz, amount, kind = "excavate") {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const { cx, cz } = cellOf(wx, wz);
  const baseY = baseElevation(wx, wz);
  const prev = deltaAt(db, worldId, cx, cz);
  const signed = kind === "raise" ? Math.abs(amount) : -Math.abs(amount);
  let next = prev + signed;
  // clamp delta into [-MAX_DIG_DEPTH, +MAX_RAISE]
  next = Math.max(-MAX_DIG_DEPTH, Math.min(MAX_RAISE, next));
  const applied = next - prev; // what actually changed after clamp
  const material = kind !== "raise" ? terrainMaterialAt(baseY, -next) : null;
  try {
    db.prepare(`
      INSERT INTO world_terrain_deformations (id, world_id, cell_x, cell_z, height_delta, kind, material_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(world_id, cell_x, cell_z) DO UPDATE SET
        height_delta = ?, kind = ?, material_id = ?, updated_at = unixepoch()
    `).run(crypto.randomUUID(), worldId, cx, cz, next, kind, material, next, kind, material);
  } catch (e) {
    return { ok: false, reason: "persist_failed", error: e?.message };
  }
  return {
    ok: true, cell: { cx, cz }, baseY,
    newDelta: Math.round(next * 100) / 100,
    appliedDelta: Math.round(applied * 100) / 100,
    newElevation: Math.round((baseY + next) * 100) / 100,
    material,
  };
}

/** All deformations in a world (optionally within a cell-radius of a centre). */
export function deformationsForWorld(db, worldId, { centreX = null, centreZ = null, cellRadius = null } = {}) {
  if (!db) return [];
  try {
    if (centreX != null && centreZ != null && cellRadius != null) {
      const { cx, cz } = cellOf(centreX, centreZ);
      return db.prepare(`
        SELECT cell_x, cell_z, height_delta, kind, material_id FROM world_terrain_deformations
        WHERE world_id = ? AND cell_x BETWEEN ? AND ? AND cell_z BETWEEN ? AND ?
      `).all(worldId, cx - cellRadius, cx + cellRadius, cz - cellRadius, cz + cellRadius);
    }
    return db.prepare(`
      SELECT cell_x, cell_z, height_delta, kind, material_id FROM world_terrain_deformations
      WHERE world_id = ?
    `).all(worldId);
  } catch { return []; }
}

/** Write a crater deformation (e.g. a building collapse). Material-scaled depth. */
export function craterAt(db, worldId, wx, wz, depth = 3) {
  return applyDeformation(db, worldId, wx, wz, Math.abs(depth), "crater");
}

export const TERRAIN_CONSTANTS = Object.freeze({ CELL_SIZE, MAX_DIG_DEPTH, MAX_RAISE, WORLD_SIZE });
