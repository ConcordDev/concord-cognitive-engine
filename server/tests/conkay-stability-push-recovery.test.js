// server/tests/conkay-stability-push-recovery.test.js
//
// Acceptance tests for stability.push-recovery.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushRecovery } from "../lib/conkay/physics/solvers/stability-push-recovery.js";

describe("stability.push-recovery — LIPM push-recovery feasibility", () => {
  it("Zero push impulse ⇒ status ok, stepDistance ≈ 0", () => {
    const r = pushRecovery({
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
      comPos: [0, 0, 1.0],
      comVel: [0, 0, 0],
      comHeight: 1.0,
      comMass: 60,
      pushImpulseNs: 0,
    });
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.stepDistanceM) < 1e-9, `stepDistanceM should be ~0, got ${r.stepDistanceM}`);
    assert.equal(r.withinStepLimit, true);
    assert.equal(r.frictionOk, true);
    assert.ok(Number.isFinite(r.stepDistanceM));
    assert.ok(Number.isFinite(r.muRequired));
  });

  it("Small push (20 N·s, 60 kg) ⇒ status ok, stepDistance between 0.09 and 0.12 m", () => {
    const r = pushRecovery({
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
      comPos: [0, 0, 1.0],
      comVel: [0, 0, 0],
      comHeight: 1.0,
      comMass: 60,
      pushImpulseNs: 20,
    });
    assert.equal(r.status, "ok");
    assert.ok(
      r.stepDistanceM > 0.09 && r.stepDistanceM < 0.12,
      `stepDistanceM expected in (0.09, 0.12), got ${r.stepDistanceM}`
    );
    assert.equal(r.withinStepLimit, true);
    assert.equal(r.frictionOk, true);
    // Sanity: response envelope fields are finite.
    assert.ok(Number.isFinite(r.icpBefore[0]));
    assert.ok(Number.isFinite(r.icpBefore[1]));
    assert.ok(Number.isFinite(r.icpAfter[0]));
    assert.ok(Number.isFinite(r.icpAfter[1]));
  });

  it("Large push (120 N·s, 60 kg) with maxStepLengthM 0.35 ⇒ status fail, withinStepLimit false", () => {
    const r = pushRecovery({
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
      comPos: [0, 0, 1.0],
      comVel: [0, 0, 0],
      comHeight: 1.0,
      comMass: 60,
      pushImpulseNs: 120,
      maxStepLengthM: 0.35,
    });
    assert.equal(r.status, "fail");
    assert.equal(r.withinStepLimit, false);
    // The required step really should exceed 0.35 m for this push.
    assert.ok(r.stepDistanceM > 0.35, `expected stepDistanceM > 0.35, got ${r.stepDistanceM}`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 0);
  });

  it("Missing comMass ⇒ status not_computed", () => {
    const r = pushRecovery({
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
      comPos: [0, 0, 1.0],
      comVel: [0, 0, 0],
      comHeight: 1.0,
      // comMass deliberately omitted
      pushImpulseNs: 20,
    });
    assert.equal(r.status, "not_computed");
    assert.ok(typeof r.reason === "string" && r.reason.length > 0);
  });

  it("High-friction-demand case: low friction coefficient ⇒ muRequired > 0.05", () => {
    // Moderate push ⇒ noticeable deceleration ⇒ μ_required well above a tiny μ_avail.
    const r = pushRecovery({
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
      comPos: [0, 0, 1.0],
      comVel: [0, 0, 0],
      comHeight: 1.0,
      comMass: 60,
      pushImpulseNs: 30,                 // 0.5 m/s newVel
      recoveryTimeS: 0.7,
      maxStepLengthM: 0.35,
      frictionCoefficient: 0.05,        // intentionally too low
    });
    assert.ok(
      r.muRequired > 0.05,
      `expected muRequired > 0.05, got ${r.muRequired}`
    );
    assert.equal(r.frictionOk, false);
    // Friction is the binding constraint here (step fits, friction fails).
    assert.equal(r.withinStepLimit, true);
    // Per spec: status is fail OR μRequired > 0.05 — verify at least one.
    assert.ok(r.status === "fail" || r.muRequired > 0.05);
    assert.equal(r.status, "fail");
    assert.ok(typeof r.reason === "string");
  });
});
