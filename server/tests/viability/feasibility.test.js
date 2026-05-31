// Wave 0/1 — the viability/constraint-geometry core (engine #2). Pins the
// feasibility math Civic Bonds' funding gate + every downstream engine import:
// box + one-sided + general constraints, Slater interior, the nearest-binding
// flag, the habitability-cone fixture, and the unmeasured-axis degrade.
//
// Run: node --test tests/viability/feasibility.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeConstraintSet, normalizeState, slack, slacks, isFeasible } from "../../lib/viability/index.js";

describe("makeConstraintSet", () => {
  it("classifies box vs general, defaults scale to |hi-lo|, weight to 1", () => {
    const set = makeConstraintSet([
      { axis: "temp", lo: 0, hi: 100 },
      { name: "chonps", g: (s) => 1 - (s.chonps ?? 0) },
    ]);
    assert.equal(set.box.length, 1);
    assert.equal(set.general.length, 1);
    assert.equal(set.box[0].scale, 100);
    assert.equal(set.box[0].weight, 1);
    assert.ok(set.axes.has("temp"));
  });

  it("accepts one-sided box (lo only)", () => {
    const set = makeConstraintSet([{ axis: "pressure", lo: 0.006, hi: null }]);
    assert.equal(set.box[0].lo, 0.006);
    assert.equal(set.box[0].hi, null);
  });
});

describe("isFeasible (Slater)", () => {
  const set = makeConstraintSet([{ axis: "x", lo: 0, hi: 10 }]);

  it("interior point is feasible WITH strict interior", () => {
    const r = isFeasible({ x: 5 }, set);
    assert.equal(r.feasible, true);
    assert.equal(r.hasInterior, true);
    assert.equal(r.violations.length, 0);
  });

  it("on the boundary is feasible but NOT strict interior", () => {
    const r = isFeasible({ x: 10 }, set);
    assert.equal(r.feasible, true);
    assert.equal(r.hasInterior, false);
  });

  it("outside is infeasible and names the violation magnitude", () => {
    const r = isFeasible({ x: 12 }, set);
    assert.equal(r.feasible, false);
    assert.equal(r.violations[0].id, "x");
    assert.equal(r.violations[0].by, 2); // 12 over the hi=10 bound by 2
  });
});

describe("slack + slacks", () => {
  it("normalises by scale so unlike axes compare", () => {
    const set = makeConstraintSet([
      { axis: "temp", lo: 0, hi: 100 },       // scale 100
      { axis: "air", lo: 0, hi: 1 },           // scale 1
    ]);
    // temp 50 → margin 50/100 = 0.5; air 0.9 → margin 0.1/1 = 0.1 (air is tighter)
    const s = slacks({ temp: 50, air: 0.9 }, set);
    const air = s.find((o) => o.id === "air");
    const temp = s.find((o) => o.id === "temp");
    assert.ok(air.normalized < temp.normalized);
    assert.equal(air.binding, true);
    assert.equal(temp.binding, false);
  });

  it("general g constraint: feasible when g<=0, slack = -g/scale", () => {
    const c = { name: "wound", g: (s) => (s.bleeding ? 1 : -1) };
    assert.equal(slack({ bleeding: false }, c), 1);   // interior
    assert.equal(slack({ bleeding: true }, c), -1);   // violated
  });
});

describe("habitability cone fixture (the canonical instantiation)", () => {
  // T in [-15,122]°C, P > 0.006 atm, plus a CHONPS availability general constraint.
  const habitable = makeConstraintSet([
    { axis: "tempC", lo: -15, hi: 122 },
    { axis: "pressureAtm", lo: 0.006, hi: null },
    { name: "chonps", g: (s) => 0.2 - (s.chonps ?? 0) }, // need chonps >= 0.2
  ]);

  it("Earth-surface point is feasible with interior", () => {
    const r = isFeasible({ tempC: 15, pressureAtm: 1, chonps: 0.9 }, habitable);
    assert.equal(r.feasible, true);
    assert.equal(r.hasInterior, true);
  });

  it("Mars-surface point is infeasible, naming pressure", () => {
    const r = isFeasible({ tempC: -60, pressureAtm: 0.006, chonps: 0.5 }, habitable);
    assert.equal(r.feasible, false);
    assert.ok(r.violations.some((v) => v.id === "tempC")); // -60 < -15
  });
});

describe("unmeasured axis degrades gracefully", () => {
  it("a missing box axis does not penalise (slack +Infinity), normalizeState fills midpoint", () => {
    const set = makeConstraintSet([{ axis: "temp", lo: 0, hi: 100 }]);
    assert.equal(slack({}, set.box[0]), Infinity);
    assert.equal(normalizeState({}, set).temp, 50); // midpoint default
    assert.equal(isFeasible({}, set).feasible, true);
  });
});
