// server/tests/conkay-stability-dynamic.test.js
//
// Closed-form acceptance tests for stability.dynamic before it touches the humanoid.
//
// Cases:
//   1. Static standing with CoM directly over support centre ⇒ ZMP = CoM_XY, in contact, OK
//   2. Static standing with CoM at support edge ⇒ ZMP outside (warn or fail)
//   3. CoM directly above foot, no accel ⇒ Capture Point = CoM
//   4. CoM moving forward ⇒ Capture Point is AHEAD of CoM
//   5. Friction cone: lateral acceleration 2 m/s² at h=1, g=9.81 ⇒ ok with µ=0.6
//   6. Friction cone: lateral acceleration 10 m/s² ⇒ fail
//   7. NOT_COMPUTED when contact array is empty
//   8. NOT_COMPUTED when CoM is at ground level (h=0)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stabilityDynamic, stabilityDynamicSingle } from "../lib/conkay/physics/solvers/stability-dynamic.js";

const G = 9.80665;

describe("stability.dynamic — ZMP, capture point, friction cone", () => {
  it("static standing over support centre: ZMP at CoM_XY, in contact", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], vel: [0, 0, 0], acc: [0, 0, 0],
      contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
    });
    assert.ok(r.zmp, "ZMP should be computed");
    assert.equal(r.zmp.x, 0);
    assert.equal(r.zmp.y, 0);
    assert.equal(r.stabilityMargin.inContact, true);
    assert.equal(r.status, "ok");
  });

  it("CoM shifted outside the support polygon: fail", () => {
    const r = stabilityDynamicSingle({
      com: [0.5, 0, 1.0],  // way outside [-0.1, 0.1] in x
      contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
    });
    assert.equal(r.zmp.x, 0.5);
    assert.equal(r.stabilityMargin.inContact, false);
    assert.equal(r.status, "fail");
  });

  it("CoM near support edge: warn (margin < 5mm)", () => {
    const r = stabilityDynamicSingle({
      com: [0.097, 0, 1.0],   // 3 mm inside edge
      contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
    });
    assert.equal(r.stabilityMargin.inContact, true);
    assert.ok(r.stabilityMargin.meters < 0.005, `expected <5mm, got ${r.stabilityMargin.meters}`);
    assert.equal(r.status, "warn");
  });

  it("Capture point with zero velocity equals CoM", () => {
    const r = stabilityDynamicSingle({
      com: [0.05, -0.02, 1.0], vel: [0, 0, 0], acc: [0, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    assert.ok(r.capturePoint);
    assert.ok(Math.abs(r.capturePoint.x - 0.05) < 1e-9);
    assert.ok(Math.abs(r.capturePoint.y - (-0.02)) < 1e-9);
  });

  it("Capture point with forward velocity is ahead of CoM", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], vel: [1.0, 0, 0], acc: [0, 0, 0],
      contacts: [{ aabb: { minX: -1, maxX: 1, minY: -1, maxY: 1 } }],
    });
    // ω = sqrt(9.81/1) ≈ 3.13. ICP_x = 0 + 1/3.13 = 0.319 m
    assert.ok(r.capturePoint.x > 0.3 && r.capturePoint.x < 0.35,
      `expected ICP_x ≈ 0.319, got ${r.capturePoint.x}`);
  });

  it("Friction cone: small lateral acceleration OK", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], vel: [0, 0, 0], acc: [2.0, 0, 0],  // 2 m/s² lateral
      frictionCoeff: 0.6,
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    // Normal force (relative) = g - a_z = 9.81 - 0 = 9.81. Tangent = 2. Ratio = 2/(0.6·9.81) = 0.34
    assert.equal(r.friction.ok, true);
    assert.ok(r.friction.ratio < 0.5, `ratio too high: ${r.friction.ratio}`);
  });

  it("Friction cone: extreme lateral acceleration fails", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], vel: [0, 0, 0], acc: [10.0, 0, 0],
      frictionCoeff: 0.6,
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    assert.equal(r.friction.ok, false);
    assert.equal(r.status, "fail");
  });

  it("Friction cone: missing coefficient ⇒ friction check not_computed but other checks run", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], vel: [0, 0, 0], acc: [2.0, 0, 0],  // small accel, ZMP inside
      frictionCoeff: null,
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    assert.equal(r.friction.ok, null);
    // ZMP still inside (-0.2m), status is ok (friction not evaluated, ZMP ok).
    assert.equal(r.status, "ok");
  });

  it("NOT_COMPUTED when contact array is empty", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 1.0], contacts: [],
    });
    assert.ok(r.notComputed, `expected notComputed, got ${JSON.stringify(r)}`);
  });

  it("NOT_COMPUTED when CoM is at ground level", () => {
    const r = stabilityDynamicSingle({
      com: [0, 0, 0.0], contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
    });
    assert.equal(r.capturePoint, null, "Capture Point should be null at h=0");
  });

  it("trajectory: rolling evaluation with aggregate status", () => {
    const r = stabilityDynamic({
      comTrajectory: [
        { p: [0, 0, 1.0], v: [0, 0, 0], a: [0, 0, 0] },           // OK
        { p: [0.5, 0, 1.0], v: [0, 0, 0], a: [0, 0, 0] },         // FAIL (outside)
        { p: [0, 0, 1.0], v: [0, 0, 0], a: [0, 0, 0] },           // OK
      ],
      contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
    });
    assert.equal(r.frames.length, 3);
    assert.equal(r.frames[0].status, "ok");
    assert.equal(r.frames[1].status, "fail");
    assert.equal(r.frames[2].status, "ok");
    assert.equal(r.status, "fail");   // aggregate
  });

  it("dual-support polygon (two contacts): ZMP on a single contact is OK", () => {
    // Two separate foot pads; ZMP on the right foot → OK.
    const r = stabilityDynamicSingle({
      com: [0.15, 0, 1.0],
      contacts: [
        { aabb: { minX: -0.2, maxX: -0.1, minY: -0.05, maxY: 0.05 } },
        { aabb: { minX: 0.1, maxX: 0.2, minY: -0.05, maxY: 0.05 } },
      ],
    });
    assert.equal(r.zmp.x, 0.15);
    assert.equal(r.stabilityMargin.inContact, true);
  });
});