// server/tests/conkay-gait-slope-walking.test.js
//
// Closed-form acceptance tests for gait.slope-walking.
//
// Every check is a pure analytic value computed from the documented
// equations (slip = atan(μ), tip = R = hypot(A,B) etc.) — no fudge factors.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slopeWalking } from "../lib/conkay/physics/solvers/gait-slope-walking.js";

describe("gait.slope-walking — slip + tip limits for a biped on a slope", () => {
  it("criticalSlipDeg = atan(μ)·180/π  for μ = 0.6  (~30.964°)", () => {
    const r = slopeWalking({ comHeight: 1.0, footLengthM: 0.25, frictionCoefficient: 0.6 });
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.criticalSlipDeg - Math.atan(0.6) * 180 / Math.PI) < 0.01,
      `criticalSlipDeg=${r.criticalSlipDeg}, expected ~${Math.atan(0.6) * 180 / Math.PI}`);
    // Sanity: 30.964 ± 0.01
    assert.ok(Math.abs(r.criticalSlipDeg - 30.9637565) < 0.01,
      `criticalSlipDeg=${r.criticalSlipDeg} not within 0.01 of 30.964`);
  });

  it("criticalSlipDeg = 45°  for μ = 1.0", () => {
    const r = slopeWalking({ comHeight: 1.0, footLengthM: 0.25, frictionCoefficient: 1.0 });
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.criticalSlipDeg - 45) < 0.01,
      `criticalSlipDeg=${r.criticalSlipDeg}`);
  });

  it("tall CoM with short foot makes tipping the binding limit (not slip)", () => {
    // High friction so slip is far away; short foot + tall CoM so tip is near.
    // comHeight 1.0, footLengthM 0.25, comOffsetFromAnkleM 0, μ = 1.5.
    // criticalSlipDeg = atan(1.5) ≈ 56.31° — well above the tipping limit.
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 1.5,
    });
    assert.equal(r.status, "ok");
    assert.ok(Number.isFinite(r.tippingSlipDeg), "expected a finite tipping limit");
    assert.ok(r.tippingSlipDeg < r.criticalSlipDeg,
      `expected tipping ${r.tippingSlipDeg}° < slip ${r.criticalSlipDeg}°`);
    assert.equal(r.walkableSlopeDeg, r.tippingSlipDeg,
      "binding limit should be tipping when it is the smaller one");
  });

  it("analytic tipping geometry: R=1, φ=90°, C/R=0.125 ⇒ tippingSlipDeg ≈ 7.18°", () => {
    // comHeight 1.0, footLengthM 0.25, comOffset 0
    //   A = 0, B = 1.0, C = 0.125
    //   R = hypot(A,B) = 1.0
    //   φ = atan2(1,0) = π/2 = 90°
    //   C/R = 0.125  ⇒  acos(0.125) ≈ 82.82°
    //   First positive root: θ = φ − acos(C/R) = 90° − 82.82° = 7.18°
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 1.5,
    });
    assert.ok(Math.abs(r.tippingSlipDeg - 7.18) < 0.5,
      `tippingSlipDeg=${r.tippingSlipDeg}, expected ~7.18° (within 0.5°)`);
    // The exact value is 90° − acos(0.125)·180/π.
    const expected = 90 - Math.acos(0.125) * 180 / Math.PI;
    assert.ok(Math.abs(r.tippingSlipDeg - expected) < 1e-9,
      `tippingSlipDeg=${r.tippingSlipDeg}, expected analytic ${expected}`);
  });

  it("5° slope is walkable: μ=1.5, tall/short body, slip- and tip-ok", () => {
    // μ = 1.5 ⇒ slip limit ~56.31°. Tip limit ~7.18°. 5° < both.
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 1.5, slopeDeg: 5,
    });
    assert.equal(r.status, "ok", `unexpected failure: ${r.reason}`);
    assert.equal(r.slipOk, true);
    assert.equal(r.tipOk, true);
    assert.ok(r.slopeMarginDeg > 0,
      `expected positive margin, got ${r.slopeMarginDeg}`);
    // requiredZmpShiftM = 0 − 0.125·cos(5°) + 1.0·sin(5°)
    const expectedShift = 0 - 0.125 * Math.cos(5 * Math.PI / 180) + 1.0 * Math.sin(5 * Math.PI / 180);
    assert.ok(Math.abs(r.requiredZmpShiftM - expectedShift) < 1e-9,
      `requiredZmpShiftM=${r.requiredZmpShiftM}, expected ${expectedShift}`);
  });

  it("30° slope with low friction (μ=0.3) fails on slip — reason mentions slip/friction", () => {
    // μ = 0.3 ⇒ slip limit ≈ 16.7°. 30° exceeds it.
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 0.3, slopeDeg: 30,
    });
    assert.equal(r.status, "fail");
    assert.equal(r.slipOk, false);
    assert.ok(/slip|friction/i.test(r.reason),
      `reason should mention slip or friction, got: ${r.reason}`);
    // slopeMarginDeg should be negative — we are past the binding limit.
    assert.ok(r.slopeMarginDeg < 0,
      `expected negative margin on failed slip, got ${r.slopeMarginDeg}`);
  });

  it("missing comHeight → not_computed naming comHeight", () => {
    const r = slopeWalking({ footLengthM: 0.25, frictionCoefficient: 0.6 });
    assert.equal(r.status, "not_computed");
    assert.ok(/comHeight/.test(r.reason),
      `reason should name comHeight, got: ${r.reason}`);
  });

  it("slopeDeg supplied but comOffsetFromAnkleM missing → not_computed", () => {
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, frictionCoefficient: 0.6, slopeDeg: 5,
    });
    assert.equal(r.status, "not_computed");
    assert.ok(/comOffsetFromAnkleM/.test(r.reason),
      `reason should name comOffsetFromAnkleM, got: ${r.reason}`);
  });

  // --- Extra tests that exercise the contract beyond the 8 mandated above ---

  it("without slopeDeg the slope-specific fields are null/ok with no requiredZmpShift", () => {
    const r = slopeWalking({ comHeight: 1.0, footLengthM: 0.30, frictionCoefficient: 0.7 });
    assert.equal(r.status, "ok");
    assert.equal(r.slopeDeg, null);
    assert.equal(r.slipOk, null);
    assert.equal(r.tipOk, null);
    assert.equal(r.requiredZmpShiftM, null);
    assert.equal(r.slopeMarginDeg, null);
    assert.ok(Number.isFinite(r.criticalSlipDeg));
    assert.ok(Number.isFinite(r.tippingSlipDeg));
  });

  it("long foot relative to CoM: C/R ≥ 1 ⇒ tippingSlipDeg is null (foot never tips)", () => {
    // comHeight 0.5, footLengthM 1.5 ⇒ C = 0.75, B = 0.5, A = 0
    // R = hypot(0, 0.5) = 0.5, C/R = 1.5  > 1  ⇒ no tipping root.
    const r = slopeWalking({
      comHeight: 0.5, footLengthM: 1.5, comOffsetFromAnkleM: 0,
      frictionCoefficient: 0.6,
    });
    assert.equal(r.tippingSlipDeg, null);
    // walkableSlopeDeg falls back to the slip limit.
    assert.equal(r.walkableSlopeDeg, r.criticalSlipDeg);
    // And on any reasonable slope with this huge foot, tip-ok must be true.
    const r2 = slopeWalking({
      comHeight: 0.5, footLengthM: 1.5, comOffsetFromAnkleM: 0.2,
      frictionCoefficient: 0.6, slopeDeg: 10,
    });
    assert.equal(r2.tipOk, true);
  });

  it("downhill slope uses the same friction budget as uphill of equal magnitude", () => {
    // Sign of slope should not change slip verdict: |tan(θ)| is what bites.
    const up = slopeWalking({
      comHeight: 1.0, footLengthM: 0.30, comOffsetFromAnkleM: 0,
      frictionCoefficient: 0.5, slopeDeg: 15,
    });
    const dn = slopeWalking({
      comHeight: 1.0, footLengthM: 0.30, comOffsetFromAnkleM: 0,
      frictionCoefficient: 0.5, slopeDeg: -15,
    });
    assert.equal(up.slipOk, dn.slipOk);
    // 15° ⇒ |tan| ≈ 0.268, well below 0.5 ⇒ ok in both directions.
    assert.equal(up.slipOk, true);
    assert.equal(dn.slipOk, true);
  });

  it("tip limit failed: reason mentions tip", () => {
    // μ = 1.5 ⇒ slip is far away. FootLength 0.25, comHeight 1.0, comOffset 0.
    // Tipping limit ≈ 7.18°. Asking for 25° must fail on tip.
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 1.5, slopeDeg: 25,
    });
    assert.equal(r.status, "fail");
    assert.equal(r.tipOk, false);
    assert.ok(/tip/i.test(r.reason),
      `reason should mention tip, got: ${r.reason}`);
  });

  it("output shape exactly matches the documented envelope", () => {
    const r = slopeWalking({
      comHeight: 1.0, footLengthM: 0.25, comOffsetFromAnkleM: 0,
      frictionCoefficient: 0.6, slopeDeg: 5, footWidthM: 0.10,
    });
    const keys = [
      "status", "reason", "slopeDeg", "criticalSlipDeg", "tippingSlipDeg",
      "walkableSlopeDeg", "slipOk", "tipOk", "requiredZmpShiftM", "slopeMarginDeg",
      "comHeight", "footLengthM", "footWidthM", "frictionCoefficient",
    ];
    for (const k of keys) {
      assert.ok(k in r, `missing output key ${k}`);
    }
    // Foot width round-trips.
    assert.equal(r.footWidthM, 0.10);
  });
});
