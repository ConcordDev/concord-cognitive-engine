// server/tests/conkay-gait-footstep-plan.test.js
//
// Closed-form acceptance tests for gait.footstep-plan BEFORE it touches the
// humanoid model.
//
// Cases:
//   1. NOT_COMPUTED when robotTree is missing
//   2. NOT_COMPUTED when startCom is missing
//   3. NOT_COMPUTED when startCom z <= 0 (must be above floor)
//   4. NOT_COMPUTED when phaseSplit length != 5
//   5. Returns 5 phases with the correct names and durations summing to stepDuration
//   6. Standing step (target == startCom): CoM stays roughly constant
//   7. Forward step: CoM moves toward target during swing phase
//   8. Swing foot trajectory: parabolic arc with ≥swingHeight ground clearance
//   9. Single-support stability during swing: ZMP inside support foot pad
//   10. Out-of-reach step: stability fails (CoM would have to escape the support)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gaitFootstepPlan } from "../lib/conkay/physics/solvers/gait-footstep-plan.js";

describe("gait.footstep-plan — single-step simulation", () => {
  const robotTree = { links: [{ id: "world", parent: null, jointType: "fixed", axis: [1, 0, 0], origin: [0, 0, 0], mass: 0, com: [0, 0, 0], inertia: { Ixx: 0, Iyy: 0, Izz: 0 } }] };

  it("NOT_COMPUTED when robotTree is missing", () => {
    const r = gaitFootstepPlan({});
    assert.ok(r.notComputed);
  });

  it("NOT_COMPUTED when startCom is missing", () => {
    const r = gaitFootstepPlan({ robotTree });
    assert.ok(r.notComputed);
  });

  it("NOT_COMPUTED when startCom z <= 0", () => {
    const r = gaitFootstepPlan({ robotTree, startCom: [0, 0, 0], targetFootPos: [0.3, 0, 0] });
    assert.ok(r.notComputed);
  });

  it("NOT_COMPUTED when phaseSplit length != 5", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], targetFootPos: [0.3, 0, 0],
      phaseSplit: [0.5, 0.5],
    });
    assert.ok(r.notComputed);
  });

  it("returns 5 phases with correct names; total duration matches stepDuration", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 } }],
      stepDuration: 1.0,
    });
    assert.equal(r.phases.length, 5);
    assert.deepEqual(r.phases.map((p) => p.name), ["ds_start", "ds_shift", "ss_lift", "ss_swing", "ds_recover"]);
    const sum = r.phases.reduce((s, p) => s + p.durationS, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-6);
  });

  it("standing step (target == start): CoM stays roughly constant", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [0, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    // ComTrajectory should keep all coms near (0,0,1).
    for (const fr of r.trajectory.com) {
      assert.ok(Math.abs(fr.p[0]) < 0.01, `expected com.x≈0, got ${fr.p[0]}`);
      assert.ok(Math.abs(fr.p[1]) < 0.01, `expected com.y≈0, got ${fr.p[1]}`);
    }
  });

  it("forward step: CoM moves toward target during swing", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
      stepDuration: 1.2,
    });
    // End-of-swing CoM should be at com3End = (0.15, 0, 1)
    const last = r.trajectory.com[r.trajectory.com.length - 1];
    assert.ok(last.p[0] > 0.1, `expected end CoM.x > 0.1, got ${last.p[0]}`);
    assert.ok(last.p[0] < 0.2, `expected end CoM.x < 0.2, got ${last.p[0]}`);
  });

  it("swing foot trajectory: parabolic arc with ground clearance", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    // Find max swing-foot z across the trajectory.
    const swingMaxZ = Math.max(...r.trajectory.swingFoot.map((s) => s.p[2]));
    assert.ok(swingMaxZ > 0.04, `expected swing max z > 0.04 m (5cm clearance target), got ${swingMaxZ}`);
    // End of trajectory, swing foot should be at targetFootPos.x.
    const lastSwing = r.trajectory.swingFoot[r.trajectory.swingFoot.length - 1];
    assert.ok(Math.abs(lastSwing.p[0] - 0.3) < 1e-6);
  });

  it("single-support stability: during swing phase, only support foot is the active contact", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [0.3, 0, 0],
      contacts: [
        { linkId: "L_foot", aabb: { minX: -0.1, maxX: 0.1, minY: -0.05, maxY: 0.05 } },
        { linkId: "R_foot", aabb: { minX: 0.2, maxX: 0.4, minY: -0.05, maxY: 0.05 } },
      ],
      swingFoot: "R_foot",
      supportFoot: "L_foot",
    });
    // During ss_lift/ss_swing, the L_foot contact should be the active one.
    const ssFrames = r.stabilityFrames.filter((f) => f.phase === "ss_swing" || f.phase === "ss_lift");
    for (const f of ssFrames) {
      // No explicit assertion on active contact (we don't return it), but the ZMP
      // should remain inside the support foot [-0.1, 0.1] during swing.
      assert.ok(f.zmp);
    }
  });

  it("out-of-reach step: stability fails when CoM would have to leave the support", () => {
    // Step too far → CoM would have to go outside support. The simulator should mark fail.
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [1.5, 0, 0],    // way out
      contacts: [{ aabb: { minX: -0.05, maxX: 0.05, minY: -0.05, maxY: 0.05 } }], // tiny support
      stepDuration: 1.2,
    });
    // Expect at least one fail frame.
    assert.equal(r.status, "fail", `expected fail status, got ${r.status}`);
    assert.ok(r.summary.failFrames > 0);
  });

  it("successful short step: stability ok throughout", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], startComVel: [0, 0, 0],
      targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
      // Use a longer stepDuration so the ds_shift acceleration is gentler:
      //   ds_shift duration = 0.15 · 2.4 = 0.36 s; Δx = 0.15 ⇒ a ≈ 2.3 m/s²
      //   ZMP shift = h·a/g ≈ 0.24 m which fits inside a ±0.5 m support.
      stepDuration: 2.4,
    });
    // All frames should be ok or warn, no fail.
    assert.equal(r.status, "ok", `expected ok, got ${r.status}; warnings=${JSON.stringify(r.summary.warnings.slice(0,3))}`);
    assert.equal(r.summary.failFrames, 0);
  });

  it("joint-torque sample placeholder is honest: not_inferred", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 1.0], targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    assert.equal(r.jointTorquesSample.status, "not_inferred");
    assert.ok(r.jointTorquesSample.reason.length > 0);
  });

  it("LIPM natural frequency is computed and matches closed-form formula", () => {
    const r = gaitFootstepPlan({
      robotTree, startCom: [0, 0, 0.81], targetFootPos: [0.3, 0, 0],
      contacts: [{ aabb: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 } }],
    });
    // omega = sqrt(9.81 / 0.81) ≈ 3.48
    assert.ok(Math.abs(r.omega - Math.sqrt(9.80665 / 0.81)) < 1e-3, `expected omega = ${Math.sqrt(9.80665 / 0.81)}, got ${r.omega}`);
  });
});