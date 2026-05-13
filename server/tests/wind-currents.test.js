/**
 * Tier-2 contract tests for Concordia Phase 7 — wind-currents.
 *
 * Pins:
 *   - windAt is deterministic per (worldId, signals)
 *   - lift is positive in hot cells, negative in cold cells
 *   - lift clamped to [MIN, MAX] bounds
 *   - magnitude scales with temp delta
 *   - hasData=false defaults to base prevailing wind + zero lift
 *   - different worlds get different prevailing angles
 *
 * Run: node --test tests/wind-currents.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { windAt, WIND_CONSTANTS } from "../lib/embodied/wind-currents.js";

describe("Phase 7 / wind-currents — windAt determinism", () => {
  it("returns same vector for same inputs", () => {
    const sig = { hasData: true, temperature: 25 };
    const a = windAt("concordia-hub", { x: 0, z: 0 }, sig);
    const b = windAt("concordia-hub", { x: 0, z: 0 }, sig);
    assert.deepEqual(a.wind, b.wind);
    assert.equal(a.lift, b.lift);
  });

  it("different worlds get different prevailing angles", () => {
    const sig = { hasData: true, temperature: 18 };
    const a = windAt("worldA", { x: 0, z: 0 }, sig);
    const b = windAt("worldB", { x: 0, z: 0 }, sig);
    // Probabilistic: 8-bit angle bucket — very high chance of differing.
    // Verify at least one of x or z differs.
    assert.ok(a.angleRad !== b.angleRad);
  });
});

describe("Phase 7 / wind-currents — lift sign by temperature", () => {
  it("lift positive in hot cell (>18°C)", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 35 });
    assert.ok(r.lift > 0);
  });

  it("lift negative in cold cell (<18°C)", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 5 });
    assert.ok(r.lift < 0);
  });

  it("lift zero at base 18°C", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 18 });
    assert.equal(r.lift, 0);
  });

  it("lift capped at THERMAL_LIFT_MAX_MS", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 200 });
    assert.equal(r.lift, WIND_CONSTANTS.THERMAL_LIFT_MAX_MS);
  });

  it("lift floored at THERMAL_LIFT_MIN_MS", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: -100 });
    assert.equal(r.lift, WIND_CONSTANTS.THERMAL_LIFT_MIN_MS);
  });
});

describe("Phase 7 / wind-currents — magnitude scaling", () => {
  it("hotter cell yields stronger wind", () => {
    const cool = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 18 });
    const hot  = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: true, temperature: 40 });
    assert.ok(hot.baseMag > cool.baseMag);
  });
});

describe("Phase 7 / wind-currents — no-data fallback", () => {
  it("no signals → base prevailing wind + zero lift", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, null);
    assert.equal(r.hasData, false);
    assert.ok(Number.isFinite(r.wind.x));
    assert.equal(r.lift, 0);
    assert.equal(r.baseMag, WIND_CONSTANTS.BASE_WIND_MAG_MS);
  });

  it("hasData=false → fallback path", () => {
    const r = windAt("concordia-hub", { x: 0, z: 0 }, { hasData: false, temperature: 99 });
    assert.equal(r.hasData, false);
    assert.equal(r.lift, 0);
  });
});
