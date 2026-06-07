// server/tests/plumbing-calculators.test.js
//
// Value-assertion regression for two plumbing calculator bugs found in the
// 2026-06 business-logic value-assertion sweep (scripts/value-assertions-batch2.mjs):
//
//   1. pipeSize — computed d² via the standard GPM = 2.448·d²·v relation but then
//      treated that quantity as a circle's cross-sectional area and applied
//      2·√(area/π), inflating the diameter by 2/√π ≈ 1.13× and oversizing the
//      recommended nominal pipe (10 GPM @ 5 ft/s → 1.02"/1.25" instead of 0.90"/1").
//   2. waterHeaterSize — tankless kW omitted the temperature-rise term, yielding an
//      absurd ~1 kW whole-house unit (real units are 18–54 kW).
//
// We invoke the registered handlers directly via the domain's register fn — no
// server boot, no DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import registerPlumbingActions from "../domains/plumbing.js";

// Capture the registered handlers.
const H = new Map();
registerPlumbingActions((domain, action, fn) => H.set(`${domain}.${action}`, fn));
const call = (action, data = {}, params = {}) => H.get(`plumbing.${action}`)({ actor: { userId: "t" } }, { data }, params);
const numIn = (s) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

test("pipeSize: diameter from GPM = 2.448·d²·v (not the circle-area inversion)", () => {
  // d = √(GPM/(2.448·v)) = √(10/12.24) = 0.9039"
  const r = call("pipeSize", { flowGPM: 10, velocityFPS: 5 }).result;
  assert.ok(Math.abs(numIn(r.calculatedDiameter) - 0.904) < 0.02, `expected ~0.904", got ${r.calculatedDiameter}`);
  // first nominal size ≥ 0.904 is 1" (the old 1.02" wrongly bumped this to 1.25")
  assert.equal(numIn(r.recommendedSize), 1, `expected 1" nominal, got ${r.recommendedSize}`);
});

test("pipeSize: default (5 GPM @ 5 ft/s) → d = √(5/12.24) = 0.639\"", () => {
  const r = call("pipeSize").result;
  assert.ok(Math.abs(numIn(r.calculatedDiameter) - 0.639) < 0.02, `got ${r.calculatedDiameter}`);
  assert.equal(numIn(r.recommendedSize), 0.75); // first ≥0.639
});

test("waterHeaterSize: tankless kW includes the ΔT term (realistic magnitude)", () => {
  // peak = 2·2.5 = 5 GPM; kW = 5·8.33·60·70/3412 = 51.3 → 51 kW
  const r = call("waterHeaterSize", { household: 4, simultaneousFixtures: 2 }).result;
  assert.equal(r.peakDemandGPM, 5);
  assert.equal(r.firstHourRating, 90);
  assert.ok(Math.abs(numIn(r.tanklessRecommendation) - 51) <= 1, `expected ~51 kW, got ${r.tanklessRecommendation}`);
});

test("waterHeaterSize: ΔT is overridable via tempRiseF", () => {
  // ΔT=40 → kW = 5·8.33·60·40/3412 = 29.3 → 29
  const r = call("waterHeaterSize", { household: 4, simultaneousFixtures: 2, tempRiseF: 40 }).result;
  assert.ok(Math.abs(numIn(r.tanklessRecommendation) - 29) <= 1, `got ${r.tanklessRecommendation}`);
});

test("drainSlope + fixtureCount still correct (no regression)", () => {
  const ds = call("drainSlope", { pipeSizeInches: 2, lengthFeet: 10 }).result;
  assert.equal(numIn(ds.slopePerFoot), 0.25);
  assert.equal(numIn(ds.totalDrop), 2.5);
  const fc = call("fixtureCount", { fixtures: [{ type: "toilet", count: 2 }, { type: "lavatory", count: 2 }] }).result;
  assert.equal(fc.totalWSFU, 7);
});
