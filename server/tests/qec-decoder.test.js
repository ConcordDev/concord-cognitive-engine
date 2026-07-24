// server/tests/qec-decoder.test.js
//
// Validates server/lib/simulation/{qec-surface-code,qec-decoder}.js against
// PUBLISHED results, not just internal self-consistency — the strongest
// available oracle for this kind of simulator. Primary reference: Delfosse &
// Nickerson, "Almost-linear time decoding algorithm for topological codes"
// (arXiv:1709.06218), which reports a Union-Find-decoder threshold of ~9.9%
// for the 2D toric code under an i.i.d. bit-flip channel with perfect
// syndrome measurement.
//
// Run: node --test --test-timeout=120000 tests/qec-decoder.test.js
// (deliberately WITHOUT --test-force-exit, per the conductor's finding that
// the flag silently truncates runs while still reporting "0 fail.")

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildToricCode,
  sampleBitFlipError,
  syndromeOf,
  homologyClass,
  isHomologicallyTrivial,
  xorEdgeSets,
} from "../lib/simulation/qec-surface-code.js";
import {
  unionFindDecode,
  runBitFlipTrial,
  runDepolarizingTrial,
  sweepLogicalErrorRate,
} from "../lib/simulation/qec-decoder.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── Lattice construction sanity ───────────────────────────────────────────

describe("buildToricCode — lattice structure", () => {
  it("distance-d toric code has d² nodes and 2d² qubits", () => {
    for (const d of [2, 3, 5, 7]) {
      const lat = buildToricCode(d);
      assert.equal(lat.numNodes, d * d);
      assert.equal(lat.numQubits, 2 * d * d);
      assert.equal(lat.edges.length, 2 * d * d);
    }
  });

  it("every node has exactly 4 incident edges (periodic boundary, no edge cases at the border)", () => {
    const lat = buildToricCode(5);
    for (let n = 0; n < lat.numNodes; n++) {
      assert.equal(lat.adjacencyOf(n).length, 4);
    }
  });

  it("every edge appears in exactly 2 nodes' adjacency lists (each qubit borders exactly 2 stabilizers)", () => {
    const lat = buildToricCode(4);
    const touchCount = new Map();
    for (let n = 0; n < lat.numNodes; n++) {
      for (const { edgeId } of lat.adjacencyOf(n)) {
        touchCount.set(edgeId, (touchCount.get(edgeId) || 0) + 1);
      }
    }
    assert.equal(touchCount.size, lat.numQubits);
    for (const count of touchCount.values()) assert.equal(count, 2);
  });
});

// ── Homology invariant sanity (the success/failure oracle itself) ─────────

describe("homologyClass — success/failure determination", () => {
  it("a single stabilizer's boundary loop is trivial (contractible)", () => {
    const lat = buildToricCode(4);
    // Boundary of plaquette (1,1): h(1,1), h(2,1), v(1,1), v(1,2)
    const d = lat.d;
    const hCount = d * d;
    const loop = new Set([1 * d + 1, 2 * d + 1, hCount + 1 * d + 1, hCount + 1 * d + 2]);
    assert.deepEqual(homologyClass(lat, loop), [0, 0]);
    assert.equal(isHomologicallyTrivial(lat, loop), true);
  });

  it("a full row of horizontal edges is a nontrivial column-wrapping loop", () => {
    const lat = buildToricCode(4);
    const d = lat.d;
    const wrap = new Set();
    for (let c = 0; c < d; c++) wrap.add(0 * d + c); // h(0, c) for all c
    const [inv1, inv2] = homologyClass(lat, wrap);
    assert.equal(inv1, 1);
    assert.equal(inv2, 0);
    assert.equal(isHomologicallyTrivial(lat, wrap), false);
  });

  it("a full column of vertical edges is a nontrivial row-wrapping loop", () => {
    const lat = buildToricCode(4);
    const d = lat.d;
    const hCount = d * d;
    const wrap = new Set();
    for (let r = 0; r < d; r++) wrap.add(hCount + r * d + 0); // v(r, 0) for all r
    const [inv1, inv2] = homologyClass(lat, wrap);
    assert.equal(inv1, 0);
    assert.equal(inv2, 1);
  });

  it("XOR of two trivial loops stays trivial (linearity)", () => {
    const lat = buildToricCode(4);
    const d = lat.d, hCount = d * d;
    const loop1 = new Set([0 * d + 0, 1 * d + 0, hCount + 0 * d + 0, hCount + 0 * d + 1]);
    const loop2 = new Set([0 * d + 1, 1 * d + 1, hCount + 0 * d + 1, hCount + 0 * d + 2]);
    const combined = xorEdgeSets(loop1, loop2);
    assert.equal(isHomologicallyTrivial(lat, combined), true);
  });
});

// ── Test 2: zero-error sanity ──────────────────────────────────────────────

describe("p = 0 sanity", () => {
  it("produces an empty syndrome and zero logical failures over many trials", () => {
    const lat = buildToricCode(5);
    const rng = lcg(1);
    let failures = 0;
    const TRIALS = 500;
    for (let t = 0; t < TRIALS; t++) {
      const error = sampleBitFlipError(lat, 0, rng);
      assert.equal(error.size, 0);
      const syndrome = syndromeOf(lat, error);
      assert.equal(syndrome.size, 0);
      const result = runBitFlipTrial(lat, 0, rng);
      assert.equal(result.logicalFailure, false);
      assert.equal(result.syndromeSize, 0);
      if (result.logicalFailure) failures++;
    }
    assert.equal(failures, 0);
  });
});

// ── Test 3: single-error correction, exhaustive at d=3 ─────────────────────

describe("single-qubit-error correction — exhaustive at d=3", () => {
  it("every weight-1 error is corrected with certainty (not sampled — all 18 qubits tried)", () => {
    const lat = buildToricCode(3);
    assert.equal(lat.numQubits, 18);
    for (let q = 0; q < lat.numQubits; q++) {
      const error = new Set([q]);
      const syndrome = syndromeOf(lat, error);
      assert.equal(syndrome.size, 2, `single-qubit error should violate exactly 2 stabilizers (qubit ${q})`);
      const { correction, residualSyndrome } = unionFindDecode(lat, syndrome);
      assert.equal(residualSyndrome.size, 0, `residual syndrome must be empty for qubit ${q}`);
      const residualError = xorEdgeSets(error, correction);
      assert.equal(
        isHomologicallyTrivial(lat, residualError), true,
        `qubit ${q}: correction ⊕ error must be a trivial loop (weight-1 errors are always within a single code's correctable radius)`
      );
    }
  });
});

// ── Test 4: determinism ─────────────────────────────────────────────────────

describe("determinism", () => {
  it("same seed produces identical syndrome and identical correction, twice", () => {
    const lat = buildToricCode(5);
    const p = 0.08;

    const rngA = lcg(777);
    const errorA = sampleBitFlipError(lat, p, rngA);
    const syndromeA = syndromeOf(lat, errorA);
    const decodeA = unionFindDecode(lat, syndromeA);

    const rngB = lcg(777);
    const errorB = sampleBitFlipError(lat, p, rngB);
    const syndromeB = syndromeOf(lat, errorB);
    const decodeB = unionFindDecode(lat, syndromeB);

    assert.ok(setsEqual(errorA, errorB), "same seed must produce the identical error pattern");
    assert.ok(setsEqual(syndromeA, syndromeB), "same seed must produce the identical syndrome");
    assert.ok(setsEqual(decodeA.correction, decodeB.correction), "same seed must produce the identical correction");
    assert.equal(decodeA.rounds, decodeB.rounds);
  });

  it("runBitFlipTrial is byte-for-byte reproducible given a fresh identically-seeded rng", () => {
    const lat = buildToricCode(5);
    const trialA = runBitFlipTrial(lat, 0.1, lcg(42));
    const trialB = runBitFlipTrial(lat, 0.1, lcg(42));
    assert.deepEqual(trialA, trialB);
  });
});

// ── Test 5: decoder never leaves a violated syndrome ────────────────────────

describe("residual syndrome always closes", () => {
  it("across many trials spanning far-below to far-above threshold, the correction always exactly closes the syndrome (independent of logical success/failure)", () => {
    const lat = buildToricCode(5);
    const rng = lcg(31415);
    const pValues = [0.01, 0.03, 0.05, 0.08, 0.099, 0.12, 0.15, 0.2, 0.3, 0.45];
    let checked = 0;
    for (const p of pValues) {
      for (let t = 0; t < 150; t++) {
        const result = runBitFlipTrial(lat, p, rng);
        assert.equal(result.residualSyndromeClosed, true, `residual syndrome left open at p=${p}, trial ${t}`);
        checked++;
      }
    }
    assert.equal(checked, pValues.length * 150);
  });

  it("holds for the depolarizing channel too (both X and Z sectors independently close)", () => {
    const lat = buildToricCode(5);
    const rng = lcg(2718);
    for (let t = 0; t < 300; t++) {
      const p = 0.02 + (t % 10) * 0.03;
      const result = runDepolarizingTrial(lat, p, rng);
      assert.equal(result.residualSyndromeClosed, true, `residual syndrome left open (depolarizing) at trial ${t}, p=${p}`);
    }
  });
});

// ── Test 1 (the headline test): threshold reproduction ─────────────────────

describe("threshold reproduction — the headline test", () => {
  it("logical error rate crosses distances near the published ~9.9% toric-code UF-decoder threshold (Delfosse & Nickerson, arXiv:1709.06218)", () => {
    const TRIALS_PER_POINT = 3000;
    const pValues = [0.04, 0.06, 0.07, 0.08, 0.09, 0.095, 0.099, 0.105, 0.11, 0.12, 0.14, 0.16];

    const seriesD3 = sweepLogicalErrorRate(3, pValues, TRIALS_PER_POINT, lcg(101), "bitflip");
    const seriesD5 = sweepLogicalErrorRate(5, pValues, TRIALS_PER_POINT, lcg(202), "bitflip");
    const seriesD7 = sweepLogicalErrorRate(7, pValues, TRIALS_PER_POINT, lcg(303), "bitflip");

    // Below-threshold requirement: at the lowest sampled p, increasing distance
    // must SUPPRESS the logical error rate (topological protection working).
    const lowP = seriesD3[0].p;
    assert.equal(lowP, pValues[0]);
    assert.ok(
      seriesD5[0].logicalErrorRate < seriesD3[0].logicalErrorRate,
      `below threshold (p=${lowP}): d=5 (${seriesD5[0].logicalErrorRate}) should beat d=3 (${seriesD3[0].logicalErrorRate})`
    );
    assert.ok(
      seriesD7[0].logicalErrorRate < seriesD5[0].logicalErrorRate,
      `below threshold (p=${lowP}): d=7 (${seriesD7[0].logicalErrorRate}) should beat d=5 (${seriesD5[0].logicalErrorRate})`
    );

    // Above-threshold requirement: at the highest sampled p, increasing
    // distance must WORSEN the logical error rate (more qubits, more ways to fail).
    const lastIdx = pValues.length - 1;
    const highP = seriesD3[lastIdx].p;
    assert.ok(
      seriesD5[lastIdx].logicalErrorRate > seriesD3[lastIdx].logicalErrorRate,
      `above threshold (p=${highP}): d=5 (${seriesD5[lastIdx].logicalErrorRate}) should be worse than d=3 (${seriesD3[lastIdx].logicalErrorRate})`
    );
    assert.ok(
      seriesD7[lastIdx].logicalErrorRate > seriesD5[lastIdx].logicalErrorRate,
      `above threshold (p=${highP}): d=7 (${seriesD7[lastIdx].logicalErrorRate}) should be worse than d=5 (${seriesD5[lastIdx].logicalErrorRate})`
    );

    // Locate the crossing: the p where the (d5 - d3) difference in logical
    // error rate flips sign from negative (d5 better, below threshold) to
    // positive (d5 worse, above threshold), linearly interpolated between
    // the bracketing sample points.
    function crossingPoint(seriesLow, seriesHigh) {
      const diffs = seriesLow.map((pt, i) => seriesHigh[i].logicalErrorRate - pt.logicalErrorRate);
      for (let i = 0; i < diffs.length - 1; i++) {
        if (diffs[i] <= 0 && diffs[i + 1] > 0) {
          const p0 = pValues[i], p1 = pValues[i + 1];
          const d0 = diffs[i], d1 = diffs[i + 1];
          const frac = d0 === d1 ? 0 : -d0 / (d1 - d0);
          return p0 + frac * (p1 - p0);
        }
      }
      return null;
    }

    const crossing35 = crossingPoint(seriesD3, seriesD5);
    const crossing57 = crossingPoint(seriesD5, seriesD7);

    console.error(
      `[qec-decoder threshold] d3/d5 crossing ≈ ${crossing35 == null ? "n/a" : crossing35.toFixed(4)}, ` +
      `d5/d7 crossing ≈ ${crossing57 == null ? "n/a" : crossing57.toFixed(4)} ` +
      `(published: 0.099, trials/point: ${TRIALS_PER_POINT}, p-grid: [${pValues.join(", ")}])`
    );

    assert.ok(crossing35 != null, "expected to find a d3/d5 crossing within the sampled p range");
    assert.ok(crossing57 != null, "expected to find a d5/d7 crossing within the sampled p range");

    // The published value is 0.099. A correct-but-noisy Monte Carlo estimate
    // should land comfortably inside [0.05, 0.15]; outside that band the
    // decoder itself is suspect, per the task's explicit instruction not to
    // tune the test to accept a wrong answer.
    assert.ok(crossing35 > 0.05 && crossing35 < 0.15, `d3/d5 crossing ${crossing35} is implausibly far from the published 9.9% threshold`);
    assert.ok(crossing57 > 0.05 && crossing57 < 0.15, `d5/d7 crossing ${crossing57} is implausibly far from the published 9.9% threshold`);
  });
});
