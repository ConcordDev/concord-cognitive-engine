// concord-frontend/lib/world-lens/terrain-deform-math.ts
//
// Destructible-world Part A — PURE math for baking server terrain-deformation
// deltas into the client heightmap (so the Rapier heightfield collider + the
// rendered mesh agree with the server's getElevationAt = base + delta).
//
// Coordinate conventions (must match both ends, verified against the code):
//   • Server cell (cx,cz): cellOf(wx,wz) = floor(wx/CELL_SIZE) — terrain-deformation.js.
//     A cell spans world x∈[cx*CELL, (cx+1)*CELL), z∈[cz*CELL, (cz+1)*CELL).
//   • Client heightmap sample: nx = (wx + WORLD_SIZE/2)/WORLD_SIZE,
//     ix = clamp(floor(nx*hmW), 0, hmW-1); hm value is normalized 0..1, ×maxElev
//     gives metres — TerrainRenderer.getElevationAt.
//
// These two functions have NO three/Rapier dependency so they're fully
// unit-testable; the physics + mesh code consumes them.

export interface HmSample {
  ix: number;
  iz: number;
}

/** Parse a "cx,cz" cell key into numbers (null on malformed). */
export function parseCellKey(key: string): { cx: number; cz: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(key));
  if (!m) return null;
  return { cx: Number(m[1]), cz: Number(m[2]) };
}

/** World X (metres) → heightmap column index, clamped. */
export function worldXToSample(wx: number, hmW: number, worldSize: number): number {
  const nx = (wx + worldSize / 2) / worldSize;
  return Math.max(0, Math.min(hmW - 1, Math.floor(nx * hmW)));
}

/**
 * The set of heightmap samples (ix,iz) covered by deformation cell (cx,cz).
 * Maps the cell's world rectangle to the inclusive sample-index range it spans
 * (a 10m cell covers ≥1 sample at any resolution; at coarse resolution several
 * cells can share a sample, which is fine — the last bake wins per sample but we
 * sum deltas before baking so order is irrelevant).
 */
export function terrainCellToHmSamples(
  cx: number,
  cz: number,
  cellSize: number,
  hmW: number,
  hmH: number,
  worldSize: number,
): HmSample[] {
  const xLo = worldXToSample(cx * cellSize, hmW, worldSize);
  const xHi = worldXToSample((cx + 1) * cellSize - 1e-3, hmW, worldSize);
  const zLo = worldXToSample(cz * cellSize, hmH, worldSize);
  const zHi = worldXToSample((cz + 1) * cellSize - 1e-3, hmH, worldSize);
  const out: HmSample[] = [];
  for (let iz = zLo; iz <= zHi; iz++) {
    for (let ix = xLo; ix <= xHi; ix++) out.push({ ix, iz });
  }
  return out;
}

/**
 * Bake per-cell height deltas (metres) into a COPY of the base heightmap.
 * Each affected sample's normalized height gets `+= delta / maxElev`. The result
 * is clamped to a sane band so a deep dig can't drive the heightfield wild.
 * Returns a new Float32Array (base is never mutated).
 */
export function bakeDeltasIntoHeightmap(
  baseHm: Float32Array,
  hmW: number,
  hmH: number,
  cellDeltas: Map<string, number>,
  cellSize: number,
  maxElev: number,
  worldSize: number,
): Float32Array {
  const out = new Float32Array(baseHm); // copy
  if (!cellDeltas || cellDeltas.size === 0) return out;
  for (const [key, delta] of cellDeltas) {
    if (!Number.isFinite(delta) || delta === 0) continue;
    const cell = parseCellKey(key);
    if (!cell) continue;
    const dNorm = delta / maxElev;
    for (const { ix, iz } of terrainCellToHmSamples(cell.cx, cell.cz, cellSize, hmW, hmH, worldSize)) {
      const idx = iz * hmW + ix;
      if (idx < 0 || idx >= out.length) continue;
      // clamp to [-0.5, 1.5] normalized (×maxElev metres) — generous but bounded
      out[idx] = Math.max(-0.5, Math.min(1.5, out[idx] + dNorm));
    }
  }
  return out;
}

/**
 * Fold a list of server deformation rows into a Map<"cx,cz", summedDelta>.
 * Rows: [{ cell_x, cell_z, height_delta }]. Multiple rows for one cell sum.
 */
export function deltaMapFromRows(
  rows: Array<{ cell_x: number; cell_z: number; height_delta: number }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows || []) {
    if (r == null || !Number.isFinite(r.height_delta)) continue;
    const key = `${r.cell_x},${r.cell_z}`;
    m.set(key, (m.get(key) || 0) + Number(r.height_delta));
  }
  return m;
}
