// Wave 5 #1 — fixed-point identity. Pins Banach iteration to a fixed point,
// attractor-detection over a state sequence, and the contraction test.
//
// Run: node --test tests/viability/fixed-point.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { iterateToFixedPoint, hasConverged, isContraction } from "../../lib/viability/fixed-point.js";

describe("iterateToFixedPoint", () => {
  it("converges to the fixed point of a contraction (x ↦ (x+10)/2 → 10)", () => {
    const r = iterateToFixedPoint((x) => (x + 10) / 2, 0);
    assert.equal(r.converged, true);
    assert.ok(Math.abs(r.fixedPoint - 10) < 1e-5);
  });

  it("converges to the Dottie number (x ↦ cos x)", () => {
    const r = iterateToFixedPoint((x) => Math.cos(x), 1, { tol: 1e-9, maxIter: 1000 });
    assert.equal(r.converged, true);
    assert.ok(Math.abs(r.fixedPoint - 0.739085) < 1e-4);
  });

  it("reports non-convergence for a divergent map within the budget", () => {
    const r = iterateToFixedPoint((x) => x * 2 + 1, 1, { maxIter: 20 });
    assert.equal(r.converged, false);
  });

  it("supports a custom distance (vector states)", () => {
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const r = iterateToFixedPoint(([x, y]) => [(x + 4) / 2, (y + 8) / 2], [0, 0], { dist });
    assert.ok(Math.abs(r.fixedPoint[0] - 4) < 1e-4 && Math.abs(r.fixedPoint[1] - 8) < 1e-4);
  });
});

describe("hasConverged (attractor detection over a sequence)", () => {
  it("true when the tail of the sequence has stabilized", () => {
    assert.equal(hasConverged([5, 3, 2.0000005, 2.0000002, 2.0000001, 2.00000005]), true);
  });
  it("false while the sequence is still drifting", () => {
    assert.equal(hasConverged([1, 2, 3, 4, 5]), false);
  });
  it("false for a too-short sequence", () => {
    assert.equal(hasConverged([1, 1]), false);
  });
});

describe("isContraction", () => {
  it("detects a contraction (slope < 1) vs an expansion", () => {
    assert.equal(isContraction((x) => x / 2, [0, 1, 2, 4, 8]).contraction, true);
    assert.equal(isContraction((x) => x * 3, [0, 1, 2, 4]).contraction, false);
  });
});
