// server/lib/world-terrain.js
//
// Server-canonical port of the Concordia hub base heightmap so a Godot
// client (or any non-Three.js client) can generate the SAME terrain the
// web client draws, instead of guessing at it from screenshots.
//
// ── Three formulas exist in this codebase (read before touching this file) ──
//
// This module ports TWO of them, plus the shared noise/seed primitives:
//
//   1. CANONICAL — concord-frontend/components/world-lens/TerrainRenderer.tsx
//      `generatePoughkeepsieHeightmap(width, height)`. This is the formula
//      the Three.js client ACTUALLY renders (confirmed by direct read of
//      TerrainRenderer.tsx: it is called from the component's mesh-build
//      path). Uses a seeded 2D simplex noise (`TERRAIN_SEED = 0xc0ffee`,
//      a fixed module-level constant, NOT per-world) for the plateau
//      lumpiness / rolling-hills / micro-noise detail layers on top of a
//      programmatic west-to-east cross-section. `terrainSpec()` below
//      sources ITS profile/sampledGrid from THIS formula — ported
//      verbatim as `generatePoughkeepsieHeightmap` (same name, same
//      operations, same order) so it is bit-identical to the client for
//      the same inputs.
//
//   2. LEGACY / UNUSED — concord-frontend/lib/world-lens/concordia-city.ts
//      `generateConcordiaHeightmap(width, height)` — the fixed,
//      world-independent east-west elevation profile (river → bluff →
//      Main Street plateau → Academy hills → Observatory peak) plus the
//      Millrace Creek valley depression, with sine-combination "noise"
//      (no simplex, no seed). Direct grep confirms this function is
//      NEVER imported anywhere in concord-frontend — it is dead/orphaned
//      code. Ported here anyway (as `generateConcordiaHeightmap` /
//      `legacyElevationAt` / `sampleConcordiaHeightLegacy`) so the work
//      from the first pass of this task isn't lost, and because it may
//      still be useful reference geography (district bounding boxes
//      elsewhere in concordia-city.ts are keyed to this same elevation
//      model). `terrainSpec()` no longer sources from this path.
//
//   3. A THIRD, independent formula lives in
//      `server/lib/terrain-deformation.js#baseElevation` — the base
//      curve the persisted dig/crater deformation deltas and the
//      water-flow substrate (`terrain-water.js`) are computed against.
//      It is a sine-APPROXIMATION of formula #1's shape (documented
//      there as needing to "match the client Simplex... shape") — a
//      structural approximation, not the same numeric function, and NOT
//      touched or reimplemented by this module.
//
//   Reconciling all three into one single canonical elevation truth
//   (render + deformation + this spec) is an explicitly out-of-scope
//   follow-up. The `/terrain-spec` route folds in the existing
//   deformation deltas + water grid because they are the only persisted
//   terrain-mutation state that exists, but — honestly — those deltas
//   were computed against formula #3's `baseElevation`, not against the
//   formula #1 profile this module returns. A future consumer combining
//   both must not assume they share a coordinate-space elevation
//   baseline.
//
// Also ported here, shared by both formulas:
//   - concord-frontend/lib/world-lens/simplex-noise.ts
//       `createSimplexNoise2D(seed)` + `octaveNoise2D(...)`. Ported
//       verbatim (same operations, same order) so it is bit-identical to
//       the client's output for the same seed and inputs.
//   - the repeated `hashSeed(s)` FNV-1a string→uint32 hash that recurs
//     across several client `lib/` modules (rock-gen.ts,
//     procedural-buildings.ts, l-system-tree.ts, armor-system.ts,
//     weapon-archetypes.ts, hair-cards.ts, mount-coat.ts) as the
//     canonical "derive a numeric seed from a string key" primitive.
//     Reserved for a future PER-WORLD detail-noise layer — today's
//     rendered formula uses a single fixed seed (0xc0ffee) for every
//     world, not a worldId-derived one; see `terrainSpec().seedDerivation`.
//
// Pure functions only. No Three.js / DOM / DB dependency — safe to
// `node --test` standalone.

// ── Geography constants (legacy formula only) ─────────────────────────
// Ported 1:1 from CONCORDIA_GEOGRAPHY in concordia-city.ts (only the
// fields the legacy heightmap formula actually consumes).

const CONCORDIA_GEOGRAPHY = Object.freeze({
  width: 2000, // metres, east-west (matches concordia-city.ts)
  depth: 1500, // metres, north-south
  resolution: Object.freeze({ columns: 100, rows: 80 }),
  river: Object.freeze({ widthMeters: 200 }),
  creek: Object.freeze({ approximateY: 500 }),
});

// ── hashSeed — FNV-1a 32-bit string hash ─────────────────────────────
// Verbatim port of the `hashSeed(s)` helper repeated across
// concord-frontend/lib/{world-lens,concordia}/*.ts (rock-gen.ts is the
// reference copy). Same string in → same uint32 out, on client or server.

export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Seeded 2D simplex noise ───────────────────────────────────────────
// Verbatim port of concord-frontend/lib/world-lens/simplex-noise.ts.
// Kept operation-for-operation identical (including the xorshift32 PRNG
// and Fisher-Yates permutation build) so a given numeric seed produces
// the exact same permutation table, and therefore the exact same noise
// field, as the client. Shared by both the legacy and canonical formulas.

const GRAD3 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

function xorshift32(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function buildPerm(rng) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Create a 2D simplex-noise function seeded from `seed` (a plain number).
 * Same seed -> same output. Returns values in [-1, 1].
 */
export function createSimplexNoise2D(seed) {
  const perm = buildPerm(xorshift32(seed));

  return function noise2D(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const g = GRAD3[gi0];
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const g = GRAD3[gi1];
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const g = GRAD3[gi2];
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}

/**
 * Octaved fractal noise — verbatim port of octaveNoise2D in
 * simplex-noise.ts. Superposes `octaves` simplex samples at geometrically
 * increasing frequency and decreasing amplitude. Returns roughly [-1, 1].
 */
export function octaveNoise2D(noise, x, y, octaves, persistence = 0.5, lacunarity = 2) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

// ══════════════════════════════════════════════════════════════════════
// CANONICAL — TerrainRenderer.tsx#generatePoughkeepsieHeightmap
// This is what the Three.js client actually renders. terrainSpec() below
// sources its profile/sampledGrid from this section.
// ══════════════════════════════════════════════════════════════════════

// Ported 1:1 from components/world-lens/TerrainRenderer.tsx. TERRAIN_SIZE
// is the component's own constant ("2km x 2km world" — square, NOT the
// legacy CONCORDIA_GEOGRAPHY's 2000x1500 rectangle; that mismatch is
// itself part of the three-formulas discrepancy documented above).
export const RENDERED_TERRAIN_CONSTANTS = Object.freeze({
  seed: 0xc0ffee, // TERRAIN_SEED in the source — a FIXED constant, not per-world
  maxElevation: 80, // maxElev in the source
  terrainSizeMeters: 2000, // TERRAIN_SIZE in the source; square (x and z both 2000)
});

// The source creates exactly one module-level noise instance and reuses
// it for every octaveNoise2D call in the heightmap function (plateau
// lumpiness, rolling hills, micro-noise). Mirrored here as a module-level
// singleton so the permutation table — and therefore every sampled value
// — is bit-identical to the client for the same (nx, nz) inputs.
const _renderedTerrainNoise = createSimplexNoise2D(RENDERED_TERRAIN_CONSTANTS.seed);

/**
 * Elevation in metres (clamped [0, maxElevation], BEFORE the source's
 * final /maxElev normalization) at a single already-normalized
 * (nx, nz) point.
 *
 * `nx`/`nz` follow the source's own convention EXACTLY: `x / width` and
 * `z / height` (NOT divided by `width - 1` / `height - 1`), so the true
 * far edge (nx === 1.0 / nz === 1.0 exactly) is never reached by a grid
 * sample at any finite width/height — matching TerrainRenderer.tsx's own
 * behaviour, not a port bug.
 *
 * This is the per-cell body of generatePoughkeepsieHeightmap, factored
 * out so it can be evaluated at an arbitrary point instead of only at a
 * fixed grid index.
 */
export function renderedElevationAt(nx, nz) {
  const maxElev = RENDERED_TERRAIN_CONSTANTS.maxElevation;

  // Base elevation profile: west-to-east cross-section
  let elev = 0;

  // River zone (0-0.1): near sea level
  if (nx < 0.1) {
    elev = 2 + nx * 30;
  }
  // Steep rise (0.1-0.2): bluff from river
  else if (nx < 0.2) {
    const t = (nx - 0.1) / 0.1;
    elev = 5 + t * t * 35; // Quadratic rise
  }
  // Central plateau (0.2-0.6)
  else if (nx < 0.6) {
    // Simplex mid-frequency adds plateau lumpiness.
    elev = 40 + octaveNoise2D(_renderedTerrainNoise, nx * 4, nz * 4, 3) * 5;
  }
  // Eastern hills (0.6-1.0)
  else {
    elev = 45 + (nx - 0.6) * 80;
    // Rolling hills via 4-octave Simplex. Output ~[-1,1] x 8 = ±8m.
    elev += octaveNoise2D(_renderedTerrainNoise, nx * 6, nz * 6, 4) * 8;
  }

  // Fall Kill Creek valley: a depression running roughly SW to NE
  const creekCenterX = 0.35 + nz * 0.15;
  const distFromCreek = Math.abs(nx - creekCenterX);
  if (distFromCreek < 0.04) {
    const creekDepth = 12 * (1 - distFromCreek / 0.04);
    elev -= creekDepth;
  }

  // Minor terrain micro-noise for natural feel — applies to EVERY cell
  // unconditionally (including the river zone), same as the source.
  elev += octaveNoise2D(_renderedTerrainNoise, nx * 60, nz * 60, 2) * 0.6;

  // Clamp (not normalized here — callers that need the source's literal
  // Float32Array contract divide by maxElevation themselves; see
  // generatePoughkeepsieHeightmap below).
  return Math.max(0, Math.min(maxElev, elev));
}

/**
 * Verbatim port of TerrainRenderer.tsx#generatePoughkeepsieHeightmap.
 * Returns a Float32Array of length width*height, row-major (`z*width+x`),
 * with values NORMALIZED to [0, 1] (elev / maxElevation) — exactly the
 * same contract as the source, so a client can diff its own port against
 * this output directly without a unit-conversion step.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array}
 */
export function generatePoughkeepsieHeightmap(width, height) {
  const data = new Float32Array(width * height);
  const maxElev = RENDERED_TERRAIN_CONSTANTS.maxElevation;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width; // 0..1, west to east (NOT /(width-1) — see renderedElevationAt doc)
      const nz = z / height; // 0..1, south to north
      const elev = renderedElevationAt(nx, nz);
      data[z * width + x] = elev / maxElev;
    }
  }

  return data;
}

/**
 * Convenience point-query in real-world metres, centred-origin
 * convention (matching TerrainRenderer.tsx's own
 * `worldX = (x/width)*terrainSize - terrainSize/2` mesh-placement
 * formula) — NOT a literal function present in the source (the source
 * only ever consumes the grid via a fixed-resolution Float32Array built
 * at mesh-construction time). Authored here as the point-queryable
 * inversion of the same formula, analogous to how the legacy
 * `sampleConcordiaHeightLegacy` inverts `generateConcordiaHeightmap`.
 * Returns metres (NOT normalized).
 */
export function sampleRenderedHeight(worldX, worldZ) {
  const size = RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters;
  const nx = (worldX + size / 2) / size;
  const nz = (worldZ + size / 2) / size;
  return renderedElevationAt(nx, nz);
}

// ══════════════════════════════════════════════════════════════════════
// LEGACY / UNUSED — concordia-city.ts#generateConcordiaHeightmap
// Confirmed by direct grep: never imported anywhere in concord-frontend.
// Kept for provenance (district geography elsewhere in concordia-city.ts
// references this same elevation model) — NOT sourced by terrainSpec().
// ══════════════════════════════════════════════════════════════════════

/**
 * LEGACY / UNUSED. Elevation (metres above river level) at a single
 * world-space point, per concordia-city.ts#generateConcordiaHeightmap's
 * per-cell body. This formula is dead code in the frontend (never
 * imported) — do not treat it as what the client renders. See the
 * module header for the full three-formulas discrepancy.
 */
export function legacyElevationAt(worldX, worldY) {
  const creekY = CONCORDIA_GEOGRAPHY.creek.approximateY;
  const riverWidth = CONCORDIA_GEOGRAPHY.river.widthMeters;

  // --- Base east-west elevation profile ---
  let elevation;

  if (worldX < riverWidth) {
    // River zone: at or below river level
    elevation = 0;
  } else if (worldX < riverWidth + 100) {
    // Steep bluff rising from waterfront
    const t = (worldX - riverWidth) / 100;
    elevation = t * t * 20;
  } else if (worldX < 500) {
    // Lower plateau approaching Main Street
    const t = (worldX - 300) / 200;
    elevation = 20 + t * 20;
  } else if (worldX < 900) {
    // Main Street plateau — relatively flat
    elevation = 40 + Math.sin(worldX * 0.008) * 3;
  } else if (worldX < 1400) {
    // Rolling transition to Academy hills
    const t = (worldX - 900) / 500;
    elevation = 40 + t * 20 + Math.sin(worldX * 0.012) * 4;
  } else {
    // Eastern high ground — Observatory peak
    const t = Math.min(1, (worldX - 1400) / 600);
    elevation = 60 + t * 20 + Math.sin(worldX * 0.01) * 3;
  }

  // --- Creek valley depression ---
  const creekDist = Math.abs(worldY - creekY);
  const creekHalfWidth = 40; // metres of valley influence
  if (creekDist < creekHalfWidth && worldX > riverWidth) {
    const creekFactor = 1 - creekDist / creekHalfWidth;
    elevation -= creekFactor * creekFactor * 10;
  }

  // --- Gentle north-south variation ---
  elevation += Math.sin(worldY * 0.005) * 2 + Math.cos(worldY * 0.012 + worldX * 0.003) * 1.5;

  // --- Small-scale terrain noise (deterministic sine combinations —
  // NOT simplex; the legacy base profile is intentionally seed-free) ---
  const noise =
    Math.sin(worldX * 0.037 + worldY * 0.029) * 0.8 +
    Math.sin(worldX * 0.071 - worldY * 0.053) * 0.5;
  elevation += noise;

  // Clamp: river cells stay at 0, everything else stays non-negative.
  return Math.max(0, Math.round(elevation * 100) / 100);
}

/**
 * LEGACY / UNUSED. Generates a height x width array of elevation values
 * in metres, matching concordia-city.ts#generateConcordiaHeightmap
 * exactly (same normalization: row/col map onto worldY/worldX across the
 * full CONCORDIA_GEOGRAPHY map extent). Dead code in the frontend — kept
 * for provenance only. terrainSpec() does NOT source from this.
 *
 * @param {number} width  Number of columns in the output grid.
 * @param {number} height Number of rows in the output grid.
 * @returns {number[][]} height x width array of elevations.
 */
export function generateConcordiaHeightmap(width, height) {
  const mapWidth = CONCORDIA_GEOGRAPHY.width;
  const mapDepth = CONCORDIA_GEOGRAPHY.depth;

  const heightmap = [];
  for (let row = 0; row < height; row++) {
    const gridRow = [];
    const worldY = (row / (height - 1)) * mapDepth;
    for (let col = 0; col < width; col++) {
      const worldX = (col / (width - 1)) * mapWidth;
      gridRow.push(legacyElevationAt(worldX, worldY));
    }
    heightmap.push(gridRow);
  }
  return heightmap;
}

/**
 * LEGACY / UNUSED. Point-query form of generateConcordiaHeightmap. Kept
 * for provenance only — terrainSpec() does NOT source from this.
 */
export function sampleConcordiaHeightLegacy(x, z) {
  return legacyElevationAt(x, z);
}

// ══════════════════════════════════════════════════════════════════════
// terrainSpec — the HTTP-facing spec, sourced from the CANONICAL formula
// ══════════════════════════════════════════════════════════════════════

const SAMPLED_GRID_DIM = 64; // downsample resolution for terrainSpec's embedded grid

function toNestedGrid(flat, width, height) {
  const rows = [];
  for (let z = 0; z < height; z++) {
    const row = new Array(width);
    for (let x = 0; x < width; x++) row[x] = flat[z * width + x];
    rows.push(row);
  }
  return rows;
}

/**
 * Build the full terrain spec for a world: the CANONICAL (rendered)
 * profile parameters, the seed-derivation primitive (reserved for a
 * future PER-WORLD detail layer — today's rendered formula uses one
 * fixed seed for every world, see `seedDerivation.appliesTo`), and a
 * downsampled sampledGrid (normalized [0,1], matching
 * generatePoughkeepsieHeightmap's own output contract exactly) a client
 * can diff its own port against to catch drift.
 *
 * Does NOT touch the DB or fold in deformation/water state — callers
 * (the HTTP route) compose those in, since this module has no DB handle.
 */
export function terrainSpec(worldId) {
  const size = RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters;
  const flatGrid = generatePoughkeepsieHeightmap(SAMPLED_GRID_DIM, SAMPLED_GRID_DIM);
  const seed = typeof worldId === "string" && worldId.length > 0 ? hashSeed(worldId) : null;

  return {
    version: "concord-terrain-spec/v1",
    worldId: worldId ?? null,
    width: size,
    height: size,
    cellSize: {
      x: size / SAMPLED_GRID_DIM,
      z: size / SAMPLED_GRID_DIM,
    },
    profile: {
      source:
        "TerrainRenderer.tsx#generatePoughkeepsieHeightmap (ported verbatim) — " +
        "the ACTUAL formula the Three.js client renders, confirmed live in the mesh-build path.",
      seeded: true,
      seedValue: RENDERED_TERRAIN_CONSTANTS.seed,
      seedIsPerWorld: false, // honest: it's one fixed constant for every world today, not worldId-derived
      maxElevationMeters: RENDERED_TERRAIN_CONSTANTS.maxElevation,
      terrainSizeMeters: size,
      sampleConvention:
        "nx = col/width, nz = row/height (NOT divided by (dim-1)) — a literal port of the source's " +
        "own convention; the far edge column/row (nx=1.0 exactly) is never sampled, matching " +
        "TerrainRenderer.tsx's own behaviour, not a port bug.",
      output: "normalized [0,1] (elevation / maxElevationMeters), matching the source's Float32Array contract",
    },
    seedDerivation: {
      algorithm: "fnv1a-32 (hashSeed)",
      seedForWorldId: seed,
      appliesTo:
        "Reserved for a future PER-WORLD detail-noise layer. The rendered formula above uses a single " +
        "FIXED seed (0xc0ffee) for every world today — this hashSeed(worldId) value is NOT currently " +
        "consumed by the profile/sampledGrid; it is exposed so a future per-world variation can be " +
        "added without breaking existing worlds' base terrain.",
    },
    sampledGrid: {
      width: SAMPLED_GRID_DIM,
      height: SAMPLED_GRID_DIM,
      data: toNestedGrid(flatGrid, SAMPLED_GRID_DIM, SAMPLED_GRID_DIM),
    },
  };
}

export { CONCORDIA_GEOGRAPHY };
