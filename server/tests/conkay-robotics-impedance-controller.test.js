// server/tests/conkay-robotics-impedance-controller.test.js
//
// Closed-form acceptance tests for robotics.impedance-controller.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { impedanceController } from "../lib/conkay/physics/solvers/robotics-impedance-controller.js";

/** Simple 3-link arm in the x–z plane, each revolute about +y.
 *  Chain convention: `linkOriginLocal[i]` is the offset from joint i to joint
 *  i+1 in link i's local frame. Link 0 sits at the base, so its offset carries
 *  the first span; the last link reaches to the end effector.
 *
 *  A straight arm at q=0 is therefore:
 *      joint1 at (0,0,−0.40) · joint2 at (0,0,−0.75) · EE at (0,0,−0.95)
 */
function arm(q = [0, 0, 0]) {
  return {
    q,
    linkOriginLocal: [[0, 0, -0.40], [0, 0, -0.35], [0, 0, -0.20]],
    linkAxis: [[0, 1, 0], [0, 1, 0], [0, 1, 0]],
    linkLengthM: [0.40, 0.35, 0.20],
    endEffectorLocal: [0, 0, 0],
  };
}

/** The end-effector pose produced by FK at q = [0,0,0]:
 *  0.40 + 0.35 + 0.20 = 0.95 straight down the −z axis. */
const EE_ZERO = [0, 0, -0.95];

const BASE = { kp: 400, kd: 40, effectiveMassKg: 2.0, maxTorqueNm: 60, maxForceN: 400 };

describe("robotics.impedance-controller — operational-space impedance", () => {
  it("closed-loop dynamics match the analytic second-order form", () => {
    const r = impedanceController({ ...arm(), ...BASE, xDesired: [0.5, 0, 0] });
    assert.notEqual(r.status, "not_computed");
    // ωn = sqrt(kp/m) = sqrt(400/2) = sqrt(200) = 14.142
    assert.ok(Math.abs(r.dynamics.naturalFrequencyRadS - Math.sqrt(200)) < 1e-9);
    // ζ = kd/(2*sqrt(kp*m)) = 40/(2*sqrt(800)) = 40/(2*28.284) = 0.7071
    assert.ok(Math.abs(r.dynamics.dampingRatio - 40 / (2 * Math.sqrt(800))) < 1e-9);
    assert.ok(Math.abs(r.dynamics.bandwidthHz - Math.sqrt(200) / (2 * Math.PI)) < 1e-9);
    assert.ok(Math.abs(r.dynamics.complianceMPerN - 1 / 400) < 1e-12);
  });

  it("FK end-effector position at the zero pose is the summed link lengths", () => {
    const r = impedanceController({ ...arm([0, 0, 0]), ...BASE, xDesired: EE_ZERO });
    // 0.4 + 0.35 + 0.2 + 0.2 (EE offset) = 1.15 straight down the −z axis.
    assert.ok(Math.abs(r.endEffector.position[0] - EE_ZERO[0]) < 1e-9, `x=${r.endEffector.position[0]}`);
    assert.ok(Math.abs(r.endEffector.position[1] - EE_ZERO[1]) < 1e-12, `y=${r.endEffector.position[1]}`);
    assert.ok(Math.abs(r.endEffector.position[2] - EE_ZERO[2]) < 1e-9, `z=${r.endEffector.position[2]}`);
  });

  it("bending the joints moves the end effector off the x axis", () => {
    const r0 = impedanceController({ ...arm([0, 0, 0]), ...BASE, xDesired: EE_ZERO });
    const r1 = impedanceController({ ...arm([Math.PI / 2, 0, 0]), ...BASE, xDesired: EE_ZERO });
    assert.ok(Math.abs(r1.endEffector.position[0]) > 0.5, `x should swing out, got ${r1.endEffector.position[0]}`);
    assert.ok(Math.abs(r1.endEffector.position[0]) > Math.abs(r0.endEffector.position[0]));
  });

  it("zero position error ⇒ zero commanded force and torque", () => {
    // Command exactly the FK pose.
    const base = arm([0, 0, 0]);
    const r0 = impedanceController({ ...base, ...BASE, xDesired: EE_ZERO });
    const r = impedanceController({ ...base, ...BASE, xDesired: [EE_ZERO[0], EE_ZERO[1], EE_ZERO[2]] });
    assert.equal(r.force.raw[0], 0);
    assert.equal(r.force.raw[1], 0);
    assert.equal(r.force.raw[2], 0);
    assert.ok(Math.abs(r.force.magnitudeN) < 1e-12);
    for (const t of r.torque.commanded) assert.ok(Math.abs(t) < 1e-12);
    assert.ok(r0);
  });

  it("proportional term follows Kp·position_error", () => {
    const r = impedanceController({ ...arm([0, 0, 0]), ...BASE, xDesired: [EE_ZERO[0], EE_ZERO[1], EE_ZERO[2] + 0.01] });
    assert.ok(Math.abs(r.force.raw[2] - 400 * 0.01) < 1e-9, `got ${r.force.raw[2]}`);
  });

  it("external force is cancelled in the commanded force", () => {
    const r = impedanceController({
      ...arm([0, 0, 0]), ...BASE,
      xDesired: EE_ZERO,
      externalForce: [0, 0, 30],
    });
    // raw = kp*0 - kd*0 - Fext = -30 on z
    assert.ok(Math.abs(r.force.raw[2] + 30) < 1e-12);
    // Steady-state deflection under 30 N with kp=400 ⇒ 30/400 = 0.075 m
    assert.ok(Math.abs(r.dynamics.steadyDeflectionM[2] - 0.075) < 1e-12);
  });

  it("undamped controller (kd=0) is reported as a stability failure", () => {
    const r = impedanceController({ ...arm([0, 0, 0]), ...BASE, kd: 0, xDesired: EE_ZERO });
    assert.equal(r.status, "fail");
    assert.ok(r.reasons.some((x) => /damping ratio/i.test(x)), r.reasons.join("; "));
  });

  it("very lightly damped controller is a warning, not a failure", () => {
    const r = impedanceController({ ...arm([0, 0, 0]), ...BASE, kd: 1, xDesired: EE_ZERO });
    assert.equal(r.status, "warn");
    assert.ok(r.reasons.some((x) => /resonance/i.test(x)), r.reasons.join("; "));
  });

  it("force saturation is reported, not silently applied", () => {
    const r = impedanceController({
      ...arm([0, 0, 0]), ...BASE, kp: 4000, maxForceN: 100,
      xDesired: [EE_ZERO[0], EE_ZERO[1], EE_ZERO[2] + 0.5],
    });
    assert.equal(r.force.saturated, true);
    assert.ok(Math.abs(r.force.magnitudeN - 4000 * 0.5) < 1e-9, "raw magnitude preserved");
    assert.ok(Math.hypot(...r.force.commanded) <= 100 + 1e-9, "commanded force clipped");
    assert.ok(r.reasons.some((x) => /force saturated/i.test(x)), r.reasons.join("; "));
  });

  it("joint torque saturation is reported per joint", () => {
    // The straight arm lies along −z, so an axial force produces no joint
    // torque. Push LATERALLY instead: ŷ × r̂ gives a real moment arm on joints
    // 0 and 1, and with an EE offset joint 2 too.
    const r = impedanceController({
      ...arm([0, 0, -0.10]), kp: 20000, kd: 0, effectiveMassKg: 2,
      maxTorqueNm: 0.5, maxForceN: 1e9,
      xDesired: [0.05, 0, -0.95],
    });
    assert.equal(r.torque.saturated, true, `expected saturation, raw=${r.torque.raw}`);
    assert.ok(r.torque.saturatedJoints.length > 0);
    for (const t of r.torque.commanded) assert.ok(Math.abs(t) <= 0.5 + 1e-12);
    // The raw (unsaturated) values are preserved for diagnosis.
    assert.ok(Math.abs(r.torque.raw[0]) > 0.5, `raw joint 0 torque ${r.torque.raw[0]} should exceed the limit`);
  });

  it("null-space posture projection removes the task component", () => {
    const r = impedanceController({
      ...arm([0.3, -0.2, 0.1]), ...BASE, xDesired: [0.5, 0, -0.5],
      postureKp: [2, 2, 2], qRest: [0, 0, 0],
      endEffectorLocal: [0, 0, -0.10],   // offset the EE so all three joints matter
    });
    assert.equal(r.nullSpace.used, true);
    assert.equal(r.nullSpace.projected, true);
    // The projected null torque must produce ~zero end-effector force:
    // Σ_i Jt[i][r] * tauNull[i] ≈ 0 for every Cartesian axis.
    for (let axis = 0; axis < 3; axis += 1) {
      const mapped = r.jacobian.Jt.reduce((acc, c, i) => acc + c[axis] * r.torque.nullspace[i], 0);
      assert.ok(Math.abs(mapped) < 1e-9, `axis ${axis} leaked ${mapped} into the task space`);
    }
  });

  it("missing required inputs are named, never guessed", () => {
    const r = impedanceController({ q: [0, 0, 0] });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.includes("linkOriginLocal"));
    assert.ok(r.missing.includes("xDesired"));
    assert.ok(r.missing.includes("kp"));
    assert.ok(r.missing.includes("kd"));
    assert.ok(r.missing.includes("effectiveMassKg"));
  });

  it("the straight pose has a singular last-joint column and no y authority", () => {
    // With the end effector flush with joint 2, that joint has zero moment arm
    // about itself, so its Jacobian column is exactly zero — a genuine
    // singularity the solver must surface rather than hide.
    const r = impedanceController({
      ...arm([0, 0, 0]), ...BASE, xDesired: EE_ZERO,
    });
    assert.ok(Array.isArray(r.jacobian.singularAxes));
    assert.deepEqual(r.jacobian.singularAxes, [2]);
    assert.ok(r.status !== "ok", "a singular Jacobian must be surfaced as warn/fail");
    assert.ok(r.reasons.some((x) => /singular/i.test(x)), r.reasons.join("; "));

    // The whole arm rotates about +y, so y translation is unreachable and the
    // y row of every Jacobian column must be zero.
    for (const col of r.jacobian.Jt) assert.ok(Math.abs(col[1]) < 1e-12, "no y Jacobian expected");
  });

  it("an offset end effector makes the last joint non-singular", () => {
    const r = impedanceController({
      ...arm([0, 0, 0]), ...BASE, xDesired: EE_ZERO,
      endEffectorLocal: [0, 0, -0.10],
    });
    assert.deepEqual(r.jacobian.singularAxes, [], "with a real moment arm no column is singular");
  });

  it("measured end-effector velocity feeds the damping term", () => {
    const r = impedanceController({
      ...arm([0, 0, 0]), ...BASE, xDesired: EE_ZERO, eeVelocity: [0, 0, 0.5],
    });
    // raw = kp*0 − kd*0.5 − 0 = −20 on z
    assert.ok(Math.abs(r.force.raw[2] + 40 * 0.5) < 1e-12);
  });
});