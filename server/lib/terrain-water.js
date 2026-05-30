// server/lib/terrain-water.js
//
// Living Society — Phase 0.6: load-bearing hydrology.
//
// A per-cell water-column grid (`world_water_cells.water_height`) over the
// base+delta terrain. A deterministic cellular-automaton flow solver moves
// water to the lowest adjacent cell each tick, CONSERVES volume, and pools in
// low ground. So: dig a ditch to a water source → water flows in, fills it,
// floods/irrigates (Minecraft-but-continuous). Swim/drown read per-cell water
// height, not a global plane.
//
// Pure-functional core (`solveFlowStep` operates on a plain cell map) so the
// solver is node --test'able and deterministic; the DB wrappers persist it.

import { baseElevation, deltaAt, cellOf, CELL_SIZE } from "./terrain-deformation.js";

const FLOW_RATE = Number(process.env.CONCORD_WATER_FLOW_RATE) || 0.5; // share of head-difference moved per step
const MIN_WATER = 0.01; // below this a cell is considered dry (GC)

/** Surface height at a cell = base+delta terrain top + water column. */
function terrainTop(db, worldId, cx, cz) {
  const wx = cx * CELL_SIZE + CELL_SIZE / 2;
  const wz = cz * CELL_SIZE + CELL_SIZE / 2;
  return baseElevation(wx, wz) + deltaAt(db, worldId, cx, cz);
}

/**
 * Pure flow step. `cells` is a Map keyed "cx,cz" → { cx, cz, terrain, water }.
 * Returns a NEW Map of updated water levels. Conserves total water (sum
 * unchanged) modulo rounding. Deterministic: neighbours visited in fixed order.
 *
 * Each cell pushes water to lower-surface neighbours proportional to the
 * surface-height difference (terrain+water), capped so it never over-drains.
 */
export function solveFlowStep(cells) {
  const next = new Map();
  for (const [k, c] of cells) next.set(k, { ...c });
  const order = [...cells.keys()].sort(); // deterministic

  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const k of order) {
    const c = next.get(k);
    if (!c || c.water <= MIN_WATER) continue;
    const surfC = c.terrain + c.water;
    // Gather lower neighbours.
    const lower = [];
    for (const [dx, dz] of NEIGHBOURS) {
      const nk = `${c.cx + dx},${c.cz + dz}`;
      const n = next.get(nk) || (cells.has(nk) ? { ...cells.get(nk) } : null);
      // A neighbour cell not in the map is treated as dry ground at its terrain
      // height (so water can flow into a freshly-dug, water-less ditch).
      const neigh = n || makeDryNeighbour(c.cx + dx, c.cz + dz, cells);
      const surfN = neigh.terrain + neigh.water;
      if (surfN < surfC - 1e-6) {
        lower.push({ nk, neigh, head: surfC - surfN });
        if (!next.has(nk)) next.set(nk, neigh);
      }
    }
    if (lower.length === 0) continue;
    const totalHead = lower.reduce((a, l) => a + l.head, 0);
    // Move at most half the smallest head per neighbour so we don't oscillate;
    // total moved capped by available water.
    let budget = Math.min(c.water, (totalHead / (lower.length + 1)) * FLOW_RATE * lower.length);
    if (budget <= 0) continue;
    for (const l of lower) {
      const share = budget * (l.head / totalHead);
      const moved = Math.min(share, c.water);
      c.water -= moved;
      next.get(l.nk).water += moved;
    }
  }
  // GC: clamp tiny negatives from float error.
  for (const c of next.values()) if (c.water < 0) c.water = 0;
  return next;
}

function makeDryNeighbour(cx, cz, cells) {
  // terrain height pulled from any sibling's terrain function is unavailable in
  // the pure path; the DB path injects terrain. In the pure test path callers
  // pre-populate neighbours, so this is only hit at the frontier — treat as a
  // high wall (no flow) unless the caller seeded it.
  const k = `${cx},${cz}`;
  if (cells.has(k)) return { ...cells.get(k) };
  return { cx, cz, terrain: Infinity, water: 0 };
}

/** Total water volume in a cell map (for conservation assertions). */
export function totalWater(cells) {
  let t = 0;
  for (const c of cells.values()) t += c.water;
  return Math.round(t * 1e6) / 1e6;
}

// ── DB wrappers ──────────────────────────────────────────────────────────────

const FLOW_NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Load the water grid for a world into a solver-shaped Map (terrain injected).
 *
 * Crucially, we ALSO inject each wet cell's 4 orthogonal neighbours as DRY
 * cells (water=0) carrying their REAL terrain top — so the flow solver can pour
 * water DOWNHILL into an empty, lower cell (e.g. a freshly-dug ditch). Without
 * this, `solveFlowStep`'s `makeDryNeighbour` treats any cell absent from the map
 * as terrain=Infinity (a wall), and water could only redistribute among
 * already-wet cells — a dug ditch would never fill. Dry cells that stay dry are
 * GC'd by `tickWaterFlow`, so this only widens the solve frontier by one ring.
 */
export function loadWaterGrid(db, worldId) {
  const cells = new Map();
  try {
    const rows = db.prepare(`
      SELECT cell_x, cell_z, water_height FROM world_water_cells WHERE world_id = ? AND water_height > ?
    `).all(worldId, MIN_WATER);
    for (const r of rows) {
      cells.set(`${r.cell_x},${r.cell_z}`, {
        cx: r.cell_x, cz: r.cell_z,
        terrain: terrainTop(db, worldId, r.cell_x, r.cell_z),
        water: Number(r.water_height) || 0,
      });
    }
    // Seed dry downhill neighbours so water can flow into empty lower cells.
    for (const r of rows) {
      for (const [dx, dz] of FLOW_NEIGHBOURS) {
        const ncx = r.cell_x + dx;
        const ncz = r.cell_z + dz;
        const nk = `${ncx},${ncz}`;
        if (cells.has(nk)) continue;
        cells.set(nk, { cx: ncx, cz: ncz, terrain: terrainTop(db, worldId, ncx, ncz), water: 0 });
      }
    }
  } catch { /* table absent */ }
  return cells;
}

/** Set a cell's water height (e.g. a spring source, or flooding from a dig). */
export function setWater(db, worldId, wx, wz, height) {
  if (!db) return { ok: false };
  const { cx, cz } = cellOf(wx, wz);
  try {
    db.prepare(`
      INSERT INTO world_water_cells (world_id, cell_x, cell_z, water_height, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(world_id, cell_x, cell_z) DO UPDATE SET water_height = ?, updated_at = unixepoch()
    `).run(worldId, cx, cz, Math.max(0, height), Math.max(0, height));
    return { ok: true, cell: { cx, cz } };
  } catch (e) { return { ok: false, error: e?.message }; }
}

/**
 * All wet cells in a world (water_height > MIN_WATER), for the 3D client's
 * dynamic water-surface renderer. Returns `[{ cell_x, cell_z, water_height }]`.
 * Never throws — minimal builds without the table get `[]`.
 */
export function waterGridForWorld(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT cell_x, cell_z, water_height FROM world_water_cells
      WHERE world_id = ? AND water_height > ?
    `).all(worldId, MIN_WATER);
  } catch { return []; }
}

/** Per-cell water depth at a world position (swim/drown reads this, not a plane). */
export function waterDepthAt(db, worldId, wx, wz) {
  if (!db) return 0;
  const { cx, cz } = cellOf(wx, wz);
  try {
    const row = db.prepare(`
      SELECT water_height FROM world_water_cells WHERE world_id = ? AND cell_x = ? AND cell_z = ?
    `).get(worldId, cx, cz);
    return row ? Math.max(0, Number(row.water_height) || 0) : 0;
  } catch { return 0; }
}

/** Run one flow tick over the world's water grid + persist. Returns cells moved. */
export function tickWaterFlow(db, worldId) {
  if (!db) return { ok: false };
  const cells = loadWaterGrid(db, worldId);
  if (cells.size === 0) return { ok: true, cellsMoved: 0 };
  const before = totalWater(cells);
  const next = solveFlowStep(cells);
  let moved = 0;
  const tx = db.transaction(() => {
    for (const c of next.values()) {
      db.prepare(`
        INSERT INTO world_water_cells (world_id, cell_x, cell_z, water_height, updated_at)
        VALUES (?, ?, ?, ?, unixepoch())
        ON CONFLICT(world_id, cell_x, cell_z) DO UPDATE SET water_height = ?, updated_at = unixepoch()
      `).run(worldId, c.cx, c.cz, Math.max(0, c.water), Math.max(0, c.water));
      moved++;
    }
    // GC dried cells.
    db.prepare(`DELETE FROM world_water_cells WHERE world_id = ? AND water_height <= ?`).run(worldId, MIN_WATER);
  });
  try { tx(); } catch (e) { return { ok: false, error: e?.message }; }
  return { ok: true, cellsMoved: moved, volumeBefore: before, volumeAfter: totalWater(next) };
}

export const WATER_CONSTANTS = Object.freeze({ FLOW_RATE, MIN_WATER });
