// server/tests/conkay-stability-pressure-distribution.test.js
//
// Acceptance tests for stability.pressure-distribution — foot pressure
// distribution + CoP + ankle torque for a single rigid biped foot.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pressureDistribution } from "../lib/conkay/physics/solvers/stability-pressure-distribution.js";

const FOOT = { x: 0, y: 0, halfX: 0.10, halfY: 0.05 };
const FZ = 700;             // 70 kg-ish biped stance
const LIMIT = 90;
const COM = [0, 0, 0.95];   // CoM 95 cm above the ground

describe("stability.pressure-distribution — foot CoP, pressure ramp, ankle torque", () => {
  it("CoP at foot centre ⇒ insideFoot true, ankle pitch/roll ≈ 0, status ok", () => {
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.insideFoot, true);
    assert.equal(r.tipping, false);
    assert.ok(Math.abs(r.ankleTorque.pitchNm) < 1e-9);
    assert.ok(Math.abs(r.ankleTorque.rollNm) < 1e-9);
    assert.equal(r.pressure.heelPa.toFixed(3), r.pressure.toePa.toFixed(3));
    assert.equal(r.pressure.latInnerPa.toFixed(3), r.pressure.latOuterPa.toFixed(3));
    // The peak is the maximum across all four edge pressures. At the foot
    // centre, the lateral axis (shorter W = 0.10 m) carries more pressure
    // per unit area than the fore-aft axis (L = 0.20 m), so peak == lateral.
    assert.equal(r.pressure.peakPa.toFixed(3), r.pressure.latInnerPa.toFixed(3));
    assert.deepEqual(r.groundReactionForceLineOfAction, { x: FOOT.x, y: FOOT.y });
  });

  it("CoP at front edge (x = fx + halfX·0.9) ⇒ ankleTorque.pitchNm ≈ FZ·halfX·0.9, status ok", () => {
    const f = 0.9;
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x + FOOT.halfX * f, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.insideFoot, true);
    assert.ok(
      Math.abs(r.ankleTorque.pitchNm - FZ * FOOT.halfX * f) < 1e-6,
      `expected pitchNm ≈ ${FZ * FOOT.halfX * f}, got ${r.ankleTorque.pitchNm}`,
    );
    assert.ok(Math.abs(r.ankleTorque.rollNm) < 1e-9);
    // Linear ramp: toe > heel at a forward CoP.
    assert.ok(r.pressure.toePa > r.pressure.heelPa);
    assert.equal(r.tipping, false);
    // peakPa is the global max across all four edge pressures; the lateral
    // axis is the tighter dimension here so it dominates.
    assert.equal(r.pressure.peakPa, r.pressure.latInnerPa);
  });

  it("CoP outside foot (x = fx + halfX·1.2) ⇒ status fail and insideFoot false", () => {
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x + FOOT.halfX * 1.2, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.status, "fail");
    assert.equal(r.insideFoot, false);
    assert.ok(r.minMarginM < 0);
    assert.equal(r.reason, "CoP outside foot patch");
    // pHeel is negative — heel would have lifted off.
    assert.ok(r.pressure.heelPa < 0);
    assert.equal(r.tipping, true);
  });

  it("CoP at rear edge ⇒ heel pressure high, toe pressure low (toePa < heelPa)", () => {
    const f = 0.6;          // rear of centre
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x - FOOT.halfX * f, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.insideFoot, true);
    assert.ok(r.pressure.heelPa > r.pressure.toePa, `expected heelPa > toePa, got heelPa=${r.pressure.heelPa}, toePa=${r.pressure.toePa}`);
    // Sanity-check the analytic linear-ramp result.
    //   pHeel = (2·Fz/L) · (0.5 − (−f·halfX)/L) = (2·Fz/L)·(0.5 + f/2)
    //   pToe  = (2·Fz/L) · (0.5 − f/2)
    const L = 2 * FOOT.halfX;
    const expectedHeel = (2 * FZ / L) * (0.5 + f / 2);
    const expectedToe = (2 * FZ / L) * (0.5 - f / 2);
    assert.ok(Math.abs(r.pressure.heelPa - expectedHeel) < 1e-6);
    assert.ok(Math.abs(r.pressure.toePa - expectedToe) < 1e-6);
    // Lateral axis is centred → both lateral pressures equal.
    assert.equal(r.pressure.latInnerPa, r.pressure.latOuterPa);
    assert.equal(r.ankleTorque.rollNm, 0);
    assert.ok(r.ankleTorque.pitchNm < 0);
  });

  it("CoP beyond front edge ⇒ toePa > 0, heelPa negative ⇒ tipping true", () => {
    const f = 1.05;         // slightly past +halfX ⇒ pHeel < 0
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x + FOOT.halfX * f, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.ok(r.pressure.toePa > 0);
    assert.ok(r.pressure.heelPa < 0, `expected heelPa < 0, got ${r.pressure.heelPa}`);
    assert.equal(r.tipping, true);
    // Even though tipping fires, the CoP is still INSIDE the patch when f < 1,
    // and OUTSIDE when f ≥ 1. We pick f = 1.05 to also cover the outside case.
    assert.equal(r.insideFoot, false);
    assert.equal(r.status, "fail");
    assert.equal(r.reason, "CoP outside foot patch");
  });

  it("CoP exactly at +halfX ⇒ pHeel = 0 ⇒ tipping true, but insideFoot still true → warn", () => {
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x + FOOT.halfX, FOOT.y],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.insideFoot, true);
    assert.equal(Math.abs(r.pressure.heelPa) < 1e-9, true, `expected pHeel ≈ 0, got ${r.pressure.heelPa}`);
    assert.equal(r.tipping, true);
    assert.equal(r.status, "warn");
  });

  it("missing both coP and comAccel ⇒ status not_computed", () => {
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      ankleTorqueLimitNm: LIMIT,
    });
    assert.equal(r.status, "not_computed");
    assert.ok(r.reason && r.reason.length > 0);
  });

  it("comAccel + comPos alone are enough to infer CoP", () => {
    // CoM at (0, 0, 0.95) with ax = 1 m/s² ⇒ inferred CoP x = −0.95 / g.
    const g = 9.80665;
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      comAccel: [1.0, 0, 0],
      ankleTorqueLimitNm: LIMIT,
    });
    const expectedX = 0 - (1.0 * 0.95) / g;
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.coP[0] - expectedX) < 1e-9, `expected coPx=${expectedX}, got ${r.coP[0]}`);
    assert.equal(r.coP[1], 0);
    // Inside the foot patch (≈ −0.097 m).
    assert.equal(r.insideFoot, true);
  });

  it("ankle torque limit exceeded (small limitNm) ⇒ status fail", () => {
    // Same CoP at front edge f=0.9 ⇒ pitchNm = FZ·halfX·0.9 = 700·0.10·0.9 = 63 Nm.
    // With limitNm = 30, that exceeds the limit.
    const f = 0.9;
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [FOOT.x + FOOT.halfX * f, FOOT.y],
      ankleTorqueLimitNm: 30,
    });
    assert.equal(r.insideFoot, true);
    assert.equal(r.tipping, false);
    assert.equal(r.status, "fail");
    assert.equal(r.reason, "ankle torque exceeds limit");
    // The magnitude should equal FZ·halfX·0.9.
    assert.ok(Math.abs(r.ankleTorque.magnitudeNm - FZ * FOOT.halfX * f) < 1e-6);
  });

  it("groundReactionForceLineOfAction equals CoP", () => {
    const r = pressureDistribution({
      footPatch: FOOT,
      totalNormalForceN: FZ,
      comPos: COM,
      coP: [0.04, -0.02],
      ankleTorqueLimitNm: LIMIT,
    });
    assert.deepEqual(r.groundReactionForceLineOfAction, { x: r.coP[0], y: r.coP[1] });
  });
});