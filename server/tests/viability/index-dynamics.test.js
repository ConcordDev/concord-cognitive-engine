// Wave 1 — the viability index (#8) + dynamics (#2 forward). Pins V monotonicity
// (toward a boundary lowers V; deep interior → 1; on boundary → 0), weighting,
// nearestBinding, the one-pass report, and willExit's first-exit prediction.
//
// Run: node --test tests/viability/index-dynamics.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeConstraintSet, viabilityIndex, nearestBinding, viabilityReport,
  stepDynamics, willExit, inViabilityKernel,
} from "../../lib/viability/index.js";

describe("viabilityIndex", () => {
  const set = makeConstraintSet([{ axis: "x", lo: 0, hi: 100 }]); // scale 100

  it("scales by margin; 0 on the boundary, 0 outside, 1 deep interior", () => {
    // tightest normalized slack at x=50 is min(50,50)/100 = 0.5; sat default 1 → V=0.5
    assert.equal(viabilityIndex({ x: 50 }, set), 0.5);
    assert.equal(viabilityIndex({ x: 50 }, set, { saturationScale: 0.5 }), 1); // 0.5/0.5 = 1 (deep enough)
    assert.equal(viabilityIndex({ x: 100 }, set), 0);    // on boundary
    assert.equal(viabilityIndex({ x: 120 }, set), 0);    // violated
  });

  it("is monotonic: moving toward a boundary lowers V", () => {
    const a = viabilityIndex({ x: 50 }, set);
    const b = viabilityIndex({ x: 80 }, set);
    const c = viabilityIndex({ x: 95 }, set);
    assert.ok(a > b && b > c);
  });

  it("weight makes an axis pull V down faster", () => {
    const light = makeConstraintSet([{ axis: "x", lo: 0, hi: 100, weight: 1 }]);
    const heavy = makeConstraintSet([{ axis: "x", lo: 0, hi: 100, weight: 4 }]);
    assert.ok(viabilityIndex({ x: 80 }, heavy) < viabilityIndex({ x: 80 }, light));
  });

  it("nearestBinding picks the tightest axis under mixed scales", () => {
    const s = makeConstraintSet([{ axis: "t", lo: 0, hi: 100 }, { axis: "a", lo: 0, hi: 1 }]);
    const n = nearestBinding({ t: 50, a: 0.9 }, s); // a margin 0.1 < t margin 0.5
    assert.equal(n.id, "a");
  });

  it("viabilityReport bundles V + feasible + nearest in one pass", () => {
    const r = viabilityReport({ x: 95 }, set);
    assert.equal(r.feasible, true);
    assert.equal(r.nearest.id, "x");
    assert.ok(r.V > 0 && r.V < 0.1);
  });
});

describe("dynamics willExit", () => {
  const set = makeConstraintSet([{ axis: "stock", lo: 0, hi: null }]); // stock must stay >= 0

  it("a decaying stock exits at the predicted step", () => {
    // stock 10, flow -2/step → hits 0 at step 5
    const r = willExit({ stock: 10 }, () => ({ stock: -2 }), set, { horizon: 12, dt: 1 });
    assert.equal(r.exits, true);
    assert.equal(r.stepOfExit, 6); // 10→8→6→4→2→0 (0 is on-boundary = feasible) → step 6 hits -2 = infeasible
  });

  it("a stable stock never exits + is in the viability kernel", () => {
    const r = willExit({ stock: 10 }, () => ({ stock: 0 }), set, { horizon: 12 });
    assert.equal(r.exits, false);
    assert.equal(inViabilityKernel({ stock: 10 }, () => ({ stock: 0 }), set), true);
  });

  it("stepDynamics integrates flow * dt", () => {
    assert.deepEqual(stepDynamics({ a: 1, b: 2 }, { a: 0.5 }, 2), { a: 2, b: 2 });
  });
});
