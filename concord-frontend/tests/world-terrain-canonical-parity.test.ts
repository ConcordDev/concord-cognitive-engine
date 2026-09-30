// concord-frontend/tests/world-terrain-canonical-parity.test.ts
//
// Anti-drift pin for the client/server elevation-formula duplication
// documented at the top of server/lib/world-terrain.js and inside
// server/lib/terrain-deformation.js#baseElevation.
//
// Ground truth established this pass (audit item 4 continuation):
//   - THREE numeric elevation formulas existed historically:
//       1. components/world-lens/TerrainRenderer.tsx#generatePoughkeepsieHeightmap
//          — CANONICAL: confirmed live, mounted via `dynamic(() =>
//          import('@/components/world-lens/TerrainRenderer'))` in
//          components/world/WorldOsSurface.tsx, drives the real mesh + collision
//          heightfield + `window.__concordiaSampleGroundY` ground sampler
//          every other scene entity (NPCs, other players, creatures) reads.
//       2. lib/world-lens/concordia-city.ts#generateConcordiaHeightmap —
//          "legacy port". Confirmed FULLY DEAD in the frontend: `grep -rln
//          "concordia-city" concord-frontend --include=*.ts --include=*.tsx`
//          (excluding node_modules) returns ZERO files. Nothing imports this
//          module, not even for its district/landmark constants. Harmless.
//       3. server/lib/terrain-deformation.js's OLD `baseElevation` — an
//          independent sine-series approximation of #1 (same qualitative
//          shape, different numeric values). This one WAS live: consumed by
//          world-gathering.js (node elevation) and terrain-water.js (flow),
//          so its divergence from #1 was a real, active bug, not theoretical.
//   - A prior pass ("T1 reconciliation", see server/lib/world-terrain.js's
//     module header + server/lib/terrain-deformation.js:16,73-75) already
//     fixed #3: `terrain-deformation.js#baseElevation` now delegates
//     directly to `world-terrain.js#renderedElevationAt` (a verbatim JS
//     port of #1), so server-side there is exactly ONE elevation formula
//     left, pinned with exact literals in server/tests/world-terrain-parity.test.js.
//   - What that fix did NOT touch (documented as the explicit residual in
//     world-terrain.js's header): the Three.js CLIENT (#1, TerrainRenderer.tsx)
//     still carries its OWN in-language copy of the formula — it can't
//     import the server's ESM module. That the client copy and the server
//     port stay numerically identical was previously ASSERTED in a code
//     comment ("ported verbatim... bit-identical") but never actually
//     PROVEN by a test that evaluates both. This file closes that gap: it
//     imports TerrainRenderer.tsx's REAL, live `generatePoughkeepsieHeightmap`
//     export directly (not a re-implementation guess) and checks it produces
//     the exact same numbers as the server's already-audited canonical
//     literals (server/tests/world-terrain-parity.test.js) via a hand-kept
//     reference transcription that reuses the ACTUAL shared noise module
//     (`@/lib/world-lens/simplex-noise`) both TerrainRenderer.tsx and the
//     server's world-terrain.js port that primitive from — so the only
//     hand-transcribed logic below is the ~20-line elevation-profile branch,
//     not the noise engine.
//
// HONEST RESIDUAL (cannot be closed from this file's scope):
//   TerrainRenderer.tsx lives in concord-frontend/components/world-lens/,
//   out of scope for this pass (owned by a sibling audit track). True
//   single-source unification — TerrainRenderer.tsx importing a shared
//   lib/world-lens/ canonical module instead of keeping its own copy of the
//   elevation-profile branch logic — needs an edit to that component file.
//   This test is the safety net until that edit lands: it will go RED the
//   moment TerrainRenderer.tsx's live formula and the server's canonical
//   port disagree, at ANY grid cell, not just the historically-pinned
//   sample points.
//
// Run: cd concord-frontend && npx vitest run tests/world-terrain-canonical-parity.test.ts

import { describe, it, expect } from 'vitest';
import { generatePoughkeepsieHeightmap as clientGeneratePoughkeepsieHeightmap } from '@/components/world-lens/TerrainRenderer';
import { createSimplexNoise2D, octaveNoise2D } from '@/lib/world-lens/simplex-noise';

// ── Reference oracle ─────────────────────────────────────────────────
// Transcribed from server/lib/world-terrain.js#renderedElevationAt, which
// is itself a verbatim port of TerrainRenderer.tsx's per-cell body. Reuses
// the REAL `@/lib/world-lens/simplex-noise` module (the same module
// TerrainRenderer.tsx imports) rather than re-implementing simplex noise a
// third time, so only the branch structure below is hand-copied.
const TERRAIN_SEED = 0xc0ffee;
const MAX_ELEV = 80;
const _referenceNoise = createSimplexNoise2D(TERRAIN_SEED);

function referenceElevationAt(nx: number, nz: number): number {
  let elev = 0;

  if (nx < 0.1) {
    elev = 2 + nx * 30;
  } else if (nx < 0.2) {
    const t = (nx - 0.1) / 0.1;
    elev = 5 + t * t * 35;
  } else if (nx < 0.6) {
    elev = 40 + octaveNoise2D(_referenceNoise, nx * 4, nz * 4, 3) * 5;
  } else {
    elev = 45 + (nx - 0.6) * 80;
    elev += octaveNoise2D(_referenceNoise, nx * 6, nz * 6, 4) * 8;
  }

  const creekCenterX = 0.35 + nz * 0.15;
  const distFromCreek = Math.abs(nx - creekCenterX);
  if (distFromCreek < 0.04) {
    const creekDepth = 12 * (1 - distFromCreek / 0.04);
    elev -= creekDepth;
  }

  elev += octaveNoise2D(_referenceNoise, nx * 60, nz * 60, 2) * 0.6;

  return Math.max(0, Math.min(MAX_ELEV, elev));
}

// The exact literals from server/tests/world-terrain-parity.test.js
// (server/lib/world-terrain.js#renderedElevationAt), established there via
// the compute-don't-guess method (run the engine, hand-verify the branch
// taken). If the reference oracle above disagrees with these, the
// transcription itself is wrong — checked first, independent of the client.
const SERVER_PINNED: Array<[number, number, number]> = [
  [0, 0, 2],
  [0.05, 0.5, 3.507440506452057],
  [0.15, 0.5, 13.668151591551288],
  [0.35, 0.5, 38.278221186367624],
  [0.42, 0.5, 26.74586100996002],
  [0.42, 0, 39.51379562154971],
  [0.8, 0.5, 61.880271531151166],
];

describe('terrain elevation: reference oracle matches the server-pinned canonical literals', () => {
  for (const [nx, nz, expected] of SERVER_PINNED) {
    it(`(${nx}, ${nz}) -> ${expected}`, () => {
      expect(referenceElevationAt(nx, nz)).toBe(expected);
    });
  }
});

describe('terrain elevation: TerrainRenderer.tsx LIVE client formula matches the canonical literals', () => {
  // Grid dimensions chosen so every pinned (nx, nz) fraction lands on an
  // exact integer cell index (nx = x/width, per TerrainRenderer.tsx's own
  // convention — NOT x/(width-1)).
  const DIM = 200;
  const grid = clientGeneratePoughkeepsieHeightmap(DIM, DIM);

  for (const [nx, nz, expectedMeters] of SERVER_PINNED) {
    const x = Math.round(nx * DIM);
    const z = Math.round(nz * DIM);
    it(`grid cell (nx=${nx}, nz=${nz}) [x=${x}, z=${z}] normalizes to the pinned meters value`, () => {
      // sanity: our chosen index really does recover the intended fraction
      expect(x / DIM).toBe(nx);
      expect(z / DIM).toBe(nz);
      const cell = grid[z * DIM + x];
      const expectedNormalized = expectedMeters / MAX_ELEV;
      // The client stores into a Float32Array (its own documented output
      // contract), so single-precision storage rounding is expected and
      // is NOT drift -- Math.fround reproduces the exact same rounding,
      // giving a bit-exact (not "close enough") comparison. This mirrors
      // server/tests/world-terrain-parity.test.js's own
      // "grid cells equal Math.fround(...)" pin.
      expect(cell).toBe(Math.fround(expectedNormalized));
    });
  }
});

describe('terrain elevation: full-grid cross-runtime parity (client live vs. reference oracle)', () => {
  // Not just the historically-pinned points -- every cell of a real grid,
  // so a LOCALIZED drift (e.g. someone tweaks only the eastern-hills branch,
  // or only the creek falloff exponent) is caught even if it happens to
  // leave the 7 discrete pins above untouched.
  const DIM = 64; // matches server terrainSpec()'s SAMPLED_GRID_DIM
  const clientGrid = clientGeneratePoughkeepsieHeightmap(DIM, DIM);

  it(`all ${DIM * DIM} cells match the reference oracle within float rounding`, () => {
    let mismatches = 0;
    const examples: string[] = [];
    for (let z = 0; z < DIM; z++) {
      for (let x = 0; x < DIM; x++) {
        const nx = x / DIM;
        const nz = z / DIM;
        const expectedNormalized = referenceElevationAt(nx, nz) / MAX_ELEV;
        const actual = clientGrid[z * DIM + x];
        // Float32Array storage (the client's own contract) rounds to
        // single precision; Math.fround reproduces that exactly.
        const expectedRounded = Math.fround(expectedNormalized);
        if (Math.abs(actual - expectedRounded) > 1e-6) {
          mismatches++;
          if (examples.length < 5) {
            examples.push(
              `(x=${x},z=${z}) nx=${nx.toFixed(4)} nz=${nz.toFixed(4)}: client=${actual} expected=${expectedRounded} (elevM=${(expectedNormalized * MAX_ELEV).toFixed(4)})`,
            );
          }
        }
      }
    }
    expect(mismatches, `${mismatches}/${DIM * DIM} cells disagree. Examples:\n${examples.join('\n')}`).toBe(0);
  });
});

describe('terrain elevation: determinism (both sides)', () => {
  it('client generatePoughkeepsieHeightmap is deterministic', () => {
    const a = clientGeneratePoughkeepsieHeightmap(16, 12);
    const b = clientGeneratePoughkeepsieHeightmap(16, 12);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('reference oracle is deterministic', () => {
    expect(referenceElevationAt(0.42, 0.5)).toBe(referenceElevationAt(0.42, 0.5));
  });
});
