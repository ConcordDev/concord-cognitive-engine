/**
 * Parity test for server/lib/world-terrain.js.
 *
 * `terrainSpec()` sources its profile/sampledGrid from the CANONICAL
 * rendered formula — a port of
 * concord-frontend/components/world-lens/TerrainRenderer.tsx#generatePoughkeepsieHeightmap
 * (TERRAIN_SEED = 0xc0ffee) — because that is the formula the Three.js
 * client actually draws (confirmed by reading TerrainRenderer.tsx: it is
 * called from the component's mesh-build path). The earlier
 * concordia-city.ts#generateConcordiaHeightmap port is kept in
 * world-terrain.js as `generateConcordiaHeightmap`/`legacyElevationAt`/
 * `sampleConcordiaHeightLegacy` for provenance (it is dead/unused code in
 * the frontend — never imported anywhere in concord-frontend) but is no
 * longer what terrainSpec() sources from; it is pinned separately below
 * so that work isn't lost.
 *
 * Pins:
 *   - renderedElevationAt()/sampleRenderedHeight() at fixed points against
 *     exact expected values. Expected values were produced by the
 *     compute-don't-guess method (CLAUDE.md "Compute-don't-guess"): run
 *     the ported function itself as the oracle, then hand-verify the
 *     RESULT against the source formula's branch structure (which
 *     elevation-tier branch fires, whether the creek depression applies,
 *     order-of-magnitude of the octave-noise contribution) — including
 *     one point, the origin (nx=nz=0), whose simplex contribution is
 *     analytically provable to be exactly zero regardless of seed (see
 *     the in-test comment), giving a seed-independent exact pin.
 *   - determinism: same (nx, nz) / same (worldX, worldZ) -> same value.
 *   - grid<->point-query consistency: generatePoughkeepsieHeightmap's
 *     Float32Array output equals Math.fround(renderedElevationAt(...) /
 *     maxElevation) exactly at every cell (the two differ from raw
 *     double-precision equality only by Float32 storage rounding, which
 *     is the SAME thing the client's own `new Float32Array(...)` does —
 *     not a port bug).
 *   - the legacy formula's own pinned values + grid consistency (kept
 *     from the first pass, unchanged, so that provenance work isn't lost).
 *   - simplex/octaveNoise2D/hashSeed contract tests (seed-shared by both
 *     formulas).
 *   - terrainSpec() shape: sources the CANONICAL formula, is stable
 *     across repeated calls, and is honest that seedDerivation is
 *     reserved-but-unused (the rendered formula's seed is one fixed
 *     constant for every world today, not worldId-derived).
 *
 * Run: cd server && node --test tests/world-terrain-parity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONCORDIA_GEOGRAPHY,
  RENDERED_TERRAIN_CONSTANTS,
  hashSeed,
  createSimplexNoise2D,
  octaveNoise2D,
  renderedElevationAt,
  generatePoughkeepsieHeightmap,
  sampleRenderedHeight,
  legacyElevationAt,
  generateConcordiaHeightmap,
  sampleConcordiaHeightLegacy,
  terrainSpec,
} from "../lib/world-terrain.js";

describe("world-terrain: CANONICAL rendered formula (generatePoughkeepsieHeightmap)", () => {
  it("origin (nx=nz=0): analytically exact regardless of seed", () => {
    // nx=0 -> river-zone branch: elev = 2 + 0*30 = 2.
    // creekCenterX = 0.35 + 0*0.15 = 0.35; distFromCreek = |0-0.35| = 0.35
    //   > 0.04 -> no creek adjustment.
    // Micro-noise: octaveNoise2D samples noise(x*freq, y*freq) for every
    //   octave; since x=y=0, every sample is noise(0,0) regardless of
    //   frequency (0*anything=0), so the octave-average collapses to
    //   exactly noise(0,0). And noise(0,0) is 0 for ANY seed: the simplex
    //   algorithm's first-corner contribution at exactly (x0,y0)=(0,0)
    //   is n0 = t0^2*(g.x0+g.y0) = t0^2*0 = 0 (x0=y0=0 regardless of the
    //   gradient), and the other two corners' falloff terms (t1, t2) are
    //   both negative at this exact input, so they contribute 0 too.
    //   Total noise(0,0) = 0 for any permutation table (see the dedicated
    //   simplex-primitive test below). So the whole micro-noise term is
    //   exactly 0.
    // Result: elev = 2 + 0 + 0.6*0 = 2, exactly, independent of TERRAIN_SEED.
    assert.equal(renderedElevationAt(0, 0), 2);
  });

  it("river zone, off-origin", () => {
    assert.equal(renderedElevationAt(0.05, 0.5), 3.507440506452057);
  });

  it("bluff branch (quadratic rise)", () => {
    assert.equal(renderedElevationAt(0.15, 0.5), 13.668151591551288);
  });

  it("central plateau branch, off the creek line", () => {
    // creekCenterX = 0.35+0.5*0.15=0.425; distFromCreek=|0.35-0.425|=0.075
    // > 0.04 -> no creek adjustment fires here.
    assert.equal(renderedElevationAt(0.35, 0.5), 38.278221186367624);
  });

  it("central plateau branch, exactly on the creek line", () => {
    // creekCenterX = 0.425 here too; distFromCreek=|0.42-0.425|=0.005 < 0.04
    // -> creekDepth = 12*(1-0.005/0.04) = 12*0.875 = 10.5 subtracted
    // (linear falloff, NOT squared — unlike the legacy formula's
    // creekFactor^2, this is a genuine formula difference between the
    // two ported functions, preserved faithfully).
    assert.equal(renderedElevationAt(0.42, 0.5), 26.74586100996002);
  });

  it("central plateau branch, same x but off the creek line at nz=0", () => {
    // creekCenterX = 0.35+0*0.15=0.35; distFromCreek=|0.42-0.35|=0.07 > 0.04
    // -> no creek adjustment (confirms the creek line moves with nz).
    assert.equal(renderedElevationAt(0.42, 0), 39.51379562154971);
  });

  it("eastern hills branch (4-octave noise)", () => {
    assert.equal(renderedElevationAt(0.8, 0.5), 61.880271531151166);
  });

  it("far corner approached (never exactly 1.0 from a grid sample, but reachable by direct point-query)", () => {
    assert.equal(renderedElevationAt(0.9999, 0.9999), 73.83647597744553);
  });

  it("is clamped into [0, maxElevation]", () => {
    for (const nx of [0, 0.05, 0.15, 0.35, 0.6, 0.8, 0.9999]) {
      for (const nz of [0, 0.25, 0.5, 0.75, 0.9999]) {
        const v = renderedElevationAt(nx, nz);
        assert.ok(v >= 0 && v <= RENDERED_TERRAIN_CONSTANTS.maxElevation, `(${nx},${nz}) -> ${v} out of range`);
      }
    }
  });

  it("sampleRenderedHeight (centred-origin world metres) matches the normalized-fraction form", () => {
    const size = RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters;
    assert.equal(sampleRenderedHeight(0, 0), renderedElevationAt(0.5, 0.5));
    assert.equal(sampleRenderedHeight(-size / 2, -size / 2), renderedElevationAt(0, 0));
    assert.equal(sampleRenderedHeight(-size / 2, -size / 2), 2); // the exact origin pin, re-derived via metres
    assert.equal(sampleRenderedHeight(size / 2, size / 2), renderedElevationAt(1, 1));
  });

  it("determinism: same input -> same output, every call", () => {
    for (const [nx, nz] of [[0, 0], [0.42, 0.5], [0.9999, 0.9999]]) {
      const a = renderedElevationAt(nx, nz);
      const b = renderedElevationAt(nx, nz);
      assert.equal(a, b);
    }
    for (const [x, z] of [[0, 0], [-820, 0], [500, -250]]) {
      assert.equal(sampleRenderedHeight(x, z), sampleRenderedHeight(x, z));
    }
  });

  it("generatePoughkeepsieHeightmap is deterministic and returns a Float32Array", () => {
    const g1 = generatePoughkeepsieHeightmap(16, 12);
    const g2 = generatePoughkeepsieHeightmap(16, 12);
    assert.ok(g1 instanceof Float32Array);
    assert.deepEqual(Array.from(g1), Array.from(g2));
  });

  it("grid cells equal Math.fround(renderedElevationAt(x/width, z/height) / maxElevation) exactly", () => {
    // Float32Array storage rounds to 32-bit float precision, same as the
    // client's own `new Float32Array(...)`. Math.fround reproduces that
    // exact rounding so the comparison is bit-exact, not "close enough".
    const width = 16, height = 12;
    const flat = generatePoughkeepsieHeightmap(width, height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width; // NOT /(width-1) -- matches the source's own convention
        const nz = z / height;
        const expected = Math.fround(renderedElevationAt(nx, nz) / RENDERED_TERRAIN_CONSTANTS.maxElevation);
        assert.equal(flat[z * width + x], expected, `mismatch at (${x},${z})`);
      }
    }
  });
});

describe("world-terrain: LEGACY generateConcordiaHeightmap (kept for provenance, unused by terrainSpec)", () => {
  it("river zone, far from the creek: elevation is 0 + N/S sine terms only", () => {
    assert.equal(sampleConcordiaHeightLegacy(0, 0), 1.5);
  });

  it("river zone, far south (past creek influence): clamps to 0", () => {
    assert.equal(sampleConcordiaHeightLegacy(0, 750), 0);
  });

  it("Main Street plateau branch, on the creek line", () => {
    assert.equal(sampleConcordiaHeightLegacy(700, 500), 28.81);
  });

  it("rolling-transition-to-Academy-hills branch, on the creek line", () => {
    assert.equal(sampleConcordiaHeightLegacy(1000, 500), 32.69);
  });

  it("far corner of the map: Observatory peak branch, t clamped to 1", () => {
    assert.equal(sampleConcordiaHeightLegacy(2000, 1500), 84.33);
  });

  it("legacyElevationAt and sampleConcordiaHeightLegacy are the same function (point-query alias)", () => {
    for (const [x, z] of [[0, 0], [850, 300], [1450, 900]]) {
      assert.equal(sampleConcordiaHeightLegacy(x, z), legacyElevationAt(x, z));
    }
  });

  it("generateConcordiaHeightmap is deterministic and grid cells match direct point-queries", () => {
    const width = 16, height = 12;
    const g1 = generateConcordiaHeightmap(width, height);
    const g2 = generateConcordiaHeightmap(width, height);
    assert.deepEqual(g1, g2);
    for (const [row, col] of [[0, 0], [5, 7], [height - 1, width - 1]]) {
      const worldY = (row / (height - 1)) * CONCORDIA_GEOGRAPHY.depth;
      const worldX = (col / (width - 1)) * CONCORDIA_GEOGRAPHY.width;
      assert.equal(g1[row][col], sampleConcordiaHeightLegacy(worldX, worldY));
    }
  });
});

describe("world-terrain: seeded simplex + octaveNoise + hashSeed primitives (shared)", () => {
  it("createSimplexNoise2D: same seed -> same output; different seed -> (almost certainly) different output", () => {
    const noiseA = createSimplexNoise2D(0xc0ffee);
    const noiseB = createSimplexNoise2D(0xc0ffee);
    const noiseC = createSimplexNoise2D(12345);
    assert.equal(noiseA(1.23, 4.56), noiseB(1.23, 4.56));
    assert.notEqual(noiseA(1.23, 4.56), noiseC(1.23, 4.56));
  });

  it("createSimplexNoise2D output stays within [-1, 1]", () => {
    const noise = createSimplexNoise2D(7);
    for (let i = 0; i < 50; i++) {
      const v = noise(i * 0.31, i * 0.17);
      assert.ok(v >= -1.0001 && v <= 1.0001, `noise(${i}) out of range: ${v}`);
    }
  });

  it("noise(0,0) is exactly 0 for any seed (the analytic fact the origin pin above relies on)", () => {
    for (const seed of [0xc0ffee, 1, 42, 999999]) {
      assert.equal(createSimplexNoise2D(seed)(0, 0), 0);
    }
  });

  it("octaveNoise2D degrades to a plain single sample at octaves=1", () => {
    const noise = createSimplexNoise2D(99);
    const single = noise(3.3, 4.4);
    const octaved = octaveNoise2D(noise, 3.3, 4.4, 1);
    assert.equal(octaved, single);
  });

  it("hashSeed is a pure FNV-1a string->uint32 hash matching the client's algorithm", () => {
    function referenceFnv1a(s) {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
    for (const key of ["concordia-hub", "tunya", "", "sovereign-ruins", "a"]) {
      assert.equal(hashSeed(key), referenceFnv1a(key));
    }
    assert.equal(hashSeed("concordia-hub"), hashSeed("concordia-hub"));
    assert.notEqual(hashSeed("concordia-hub"), hashSeed("tunya"));
    assert.ok(hashSeed("concordia-hub") >= 0 && hashSeed("concordia-hub") <= 0xffffffff);
  });
});

describe("world-terrain: terrainSpec() sources the CANONICAL rendered formula", () => {
  it("embeds the rendered formula's real extent + a stable sampledGrid a client can diff against", () => {
    const spec = terrainSpec("concordia-hub");
    assert.equal(spec.version, "concord-terrain-spec/v1");
    assert.equal(spec.worldId, "concordia-hub");
    assert.equal(spec.width, RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters);
    assert.equal(spec.height, RENDERED_TERRAIN_CONSTANTS.terrainSizeMeters);
    assert.equal(spec.profile.source.includes("generatePoughkeepsieHeightmap"), true);
    assert.equal(spec.profile.seeded, true);
    assert.equal(spec.profile.seedValue, RENDERED_TERRAIN_CONSTANTS.seed);
    assert.equal(spec.profile.seedIsPerWorld, false); // honesty: one fixed seed for every world today
    assert.equal(spec.profile.maxElevationMeters, RENDERED_TERRAIN_CONSTANTS.maxElevation);

    assert.equal(spec.sampledGrid.width, 64);
    assert.equal(spec.sampledGrid.height, 64);
    // sampledGrid is the nested-array form of generatePoughkeepsieHeightmap(64,64).
    const flat = generatePoughkeepsieHeightmap(64, 64);
    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        assert.equal(spec.sampledGrid.data[z][x], flat[z * 64 + x]);
      }
    }
  });

  it("is stable across repeated calls for the same worldId", () => {
    const s1 = terrainSpec("concordia-hub");
    const s2 = terrainSpec("concordia-hub");
    assert.deepEqual(s1, s2);
  });

  it("seedDerivation is honestly reserved-but-unused: differs per worldId, but the sampledGrid does not", () => {
    const specA = terrainSpec("concordia-hub");
    const specB = terrainSpec("tunya");
    assert.notEqual(specA.seedDerivation.seedForWorldId, specB.seedDerivation.seedForWorldId);
    assert.equal(specA.seedDerivation.seedForWorldId, hashSeed("concordia-hub"));
    // The rendered formula uses ONE fixed seed (0xc0ffee) for every world
    // today -- hashSeed(worldId) is not yet wired into the profile, so
    // the sampledGrid is identical regardless of worldId. This is a
    // documented, deliberate limitation (see seedDerivation.appliesTo),
    // not a bug.
    assert.deepEqual(specA.sampledGrid.data, specB.sampledGrid.data);
  });

  it("handles a missing worldId honestly (null, not a fabricated default)", () => {
    const spec = terrainSpec();
    assert.equal(spec.worldId, null);
    assert.equal(spec.seedDerivation.seedForWorldId, null);
  });
});
