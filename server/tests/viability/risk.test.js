// Engine N6 × viability — risk = P(exit). Pins that a safely-centred low-noise
// state has near-zero exit risk, a near-boundary high-volatility state is at
// high risk, adverse drift raises risk, and the riskiest axis is named.
// Deterministic via a seeded rng.
//
// Run: node --test tests/viability/risk.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeConstraintSet } from "../../lib/viability/constraint-set.js";
import { riskOfExit } from "../../lib/viability/risk.js";

// seeded PRNG so the Monte-Carlo is reproducible
function seeded(seed) {
  let h = seed >>> 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const SET = makeConstraintSet([
  { axis: "temp", lo: 0, hi: 100 },
  { axis: "fuel", lo: 0, hi: null },
]);

describe("riskOfExit", () => {
  it("a centred, low-noise state has near-zero exit risk", () => {
    const r = riskOfExit({ temp: 50, fuel: 80 }, SET, { volatility: 0.5, horizon: 20, rng: seeded(1) });
    assert.ok(r.risk < 0.1, `risk ${r.risk}`);
  });

  it("a near-boundary, high-volatility state is at high risk", () => {
    const r = riskOfExit({ temp: 96, fuel: 80 }, SET, { volatility: 4, horizon: 20, rng: seeded(2) });
    assert.ok(r.risk > 0.5, `risk ${r.risk}`);
    assert.equal(r.mostAtRisk, "temp"); // temp is the axis near its ceiling
  });

  it("adverse drift toward a floor raises depletion risk", () => {
    const noDrift = riskOfExit({ temp: 50, fuel: 20 }, SET, { volatility: 1, flow: { fuel: 0 }, horizon: 25, rng: seeded(3) });
    const draining = riskOfExit({ temp: 50, fuel: 20 }, SET, { volatility: 1, flow: { fuel: -1.2 }, horizon: 25, rng: seeded(3) });
    assert.ok(draining.byAxis.fuel > noDrift.byAxis.fuel, `${draining.byAxis.fuel} > ${noDrift.byAxis.fuel}`);
    assert.equal(draining.mostAtRisk, "fuel");
  });

  it("ignores axes with no measured value + handles an empty set", () => {
    const r = riskOfExit({ temp: 50 }, SET, { volatility: 0.5, rng: seeded(4) });
    assert.ok(!("fuel" in r.byAxis)); // fuel not provided → skipped
    assert.equal(riskOfExit({ a: 1 }, makeConstraintSet([])).risk, 0);
  });
});
