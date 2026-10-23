// server/tests/conkay-dynamics-full-body-rnea.test.js
//
// Acceptance tests for dynamics.full-body-rnea — the whole-body wrapper around
// dynamics.inverse (recursive Newton–Euler inverse dynamics).
//
// Tree under test: a 16-DOF humanoid
//   pelvis (base, fixed)
//     ├─ torso (revolute, pitch-x)
//     │    ├─ head (revolute, yaw-y)
//     │    ├─ left_shoulder (revolute, pitch-x)
//     │    │    ├─ left_arm_upper (revolute, yaw-y)        ← left_arm
//     │    │    └─ left_elbow (revolute, pitch-x)
//     │    └─ right_shoulder (revolute, pitch-x)
//     │         ├─ right_arm_upper (revolute, yaw-y)       ← right_arm
//     │         └─ right_elbow (revolute, pitch-x)
//     ├─ left_hip (revolute, pitch-x)
//     │    ├─ left_thigh (revolute, pitch-x)
//     │    │    ├─ left_shin (revolute, pitch-x)
//     │    │    │    └─ left_foot (revolute, pitch-x)
//     ├─ right_hip (revolute, pitch-x)
//          ├─ right_thigh (revolute, pitch-x)
//          │    ├─ right_shin (revolute, pitch-x)
//          │    │    └─ right_foot (revolute, pitch-x)
//
// That's 1 torso + 1 head + (3+3) arms + (4+4) legs = 16 revolute joints.
//
// Cases:
//   1. Vertical straight-leg standing: gravity produces no torque about
//      aligned pitch joints. Knee/thigh magnitudes < 1e-6.
//   2. Arm extended horizontally: the shoulder sees a real gravity torque
//      > 0.1 N·m.
//   3. Region grouping: counts > 0 for torso, legs, and arms.
//   4. totalVerticalForceN equals totalMassKg·G within 1e-6.
//   5. Forward-lean posture: gravityMomentNm.{x,y} is non-zero.
//   6. q length mismatch: returns status "not_computed" with the counts
//      named in the reason string.
//   7. torqueLimitNm exceeded: status = "fail" with the offending joints
//      listed in overLimitJoints.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fullBodyRnea } from "../lib/conkay/physics/solvers/dynamics-full-body-rnea.js";

const G = 9.80665;

/* ----------------------------- link factories ----------------------------- */
function mkI(Ixx, Iyy, Izz, Ixy = 0, Ixz = 0, Iyz = 0) {
  return { Ixx, Iyy, Izz, Ixy, Ixz, Iyz };
}
function link(id, opts) {
  return {
    id,
    parent: opts.parent ?? null,
    jointType: opts.jointType ?? "revolute",
    axis: opts.axis ?? [1, 0, 0],
    origin: opts.origin ?? [0, 0, 0],
    mass: opts.mass ?? 1,
    com: opts.com ?? [0, 0, 0],
    inertia: opts.inertia ?? mkI(0.01, 0.01, 0.01),
  };
}

/* ----------------------- 16-DOF humanoid tree ----------------------- */
// Coordinate frame: world z-up. The pelvis sits at world origin. Links extend
// downward along the local -z from their parent's origin (per the dynamics.inverse
// convention: q=0 means the child's frame is offset by `origin` from the
// parent frame, no rotation).
function makeHumanoidTree() {
  // approximate humanoid geometry (m, kg)
  const links = [
    // pelvis — the kinematic root, fixed to world (basePos = [0,0,0]).
    link("pelvis", { parent: null, jointType: "fixed", axis: [1, 0, 0], origin: [0, 0, 0], mass: 8, com: [0, 0, 0], inertia: mkI(0.10, 0.10, 0.10) }),

    // torso segment extending along +z from the pelvis.
    link("torso", { parent: "pelvis", origin: [0, 0, 0.10], mass: 18, com: [0, 0, 0.25], inertia: mkI(0.6, 0.4, 0.4) }),

    // head at the top of the torso.
    link("head", { parent: "torso", origin: [0, 0, 0.55], mass: 4.5, com: [0, 0, 0.05], inertia: mkI(0.02, 0.02, 0.02) }),

    // ---- left arm ----
    link("left_shoulder", { parent: "torso", origin: [0.10, 0, 0.40], mass: 1.5, com: [0, 0, -0.05], inertia: mkI(0.005, 0.005, 0.005) }),
    link("left_arm",      { parent: "left_shoulder", origin: [0, 0, -0.10], mass: 1.5, com: [0, 0, -0.15], inertia: mkI(0.005, 0.005, 0.005) }),
    link("left_hand",     { parent: "left_arm", origin: [0, 0, -0.30], mass: 0.6, com: [0, 0, -0.05], inertia: mkI(0.002, 0.002, 0.002) }),

    // ---- right arm ----
    link("right_shoulder", { parent: "torso", origin: [-0.10, 0, 0.40], mass: 1.5, com: [0, 0, -0.05], inertia: mkI(0.005, 0.005, 0.005) }),
    link("right_arm",      { parent: "right_shoulder", origin: [0, 0, -0.10], mass: 1.5, com: [0, 0, -0.15], inertia: mkI(0.005, 0.005, 0.005) }),
    link("right_hand",     { parent: "right_arm", origin: [0, 0, -0.30], mass: 0.6, com: [0, 0, -0.05], inertia: mkI(0.002, 0.002, 0.002) }),

    // ---- left leg ----
    link("left_hip",   { parent: "pelvis", origin: [0.07, 0, -0.05], mass: 2.0, com: [0, 0, -0.10], inertia: mkI(0.04, 0.04, 0.02) }),
    link("left_thigh", { parent: "left_hip", origin: [0, 0, -0.10], mass: 5.0, com: [0, 0, -0.20], inertia: mkI(0.10, 0.10, 0.04) }),
    link("left_shin",  { parent: "left_thigh", origin: [0, 0, -0.40], mass: 3.0, com: [0, 0, -0.20], inertia: mkI(0.06, 0.06, 0.02) }),
    link("left_foot",  { parent: "left_shin", origin: [0, 0, -0.40], mass: 1.0, com: [0, 0.05, -0.05], inertia: mkI(0.01, 0.01, 0.005) }),

    // ---- right leg ----
    link("right_hip",   { parent: "pelvis", origin: [-0.07, 0, -0.05], mass: 2.0, com: [0, 0, -0.10], inertia: mkI(0.04, 0.04, 0.02) }),
    link("right_thigh", { parent: "right_hip", origin: [0, 0, -0.10], mass: 5.0, com: [0, 0, -0.20], inertia: mkI(0.10, 0.10, 0.04) }),
    link("right_shin",  { parent: "right_thigh", origin: [0, 0, -0.40], mass: 3.0, com: [0, 0, -0.20], inertia: mkI(0.06, 0.06, 0.02) }),
    link("right_foot",  { parent: "right_shin", origin: [0, 0, -0.40], mass: 1.0, com: [0, -0.05, -0.05], inertia: mkI(0.01, 0.01, 0.005) }),
  ];

  return {
    links,
    baseR: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    basePos: [0, 0, 0],
    gravity: [0, 0, -G],
  };
}

/* revolute links in declaration order, used to map q[i] → link id */
const REVOLUTE_IDS = [
  "torso", "head",
  "left_shoulder", "left_arm", "left_hand",
  "right_shoulder", "right_arm", "right_hand",
  "left_hip", "left_thigh", "left_shin", "left_foot",
  "right_hip", "right_thigh", "right_shin", "right_foot",
];
assert.equal(REVOLUTE_IDS.length, 16, "expected 16 revolute ids");

/* Build default q/qdot/qddot of the requested size, optionally overriding values by link id. */
function makePose(size, overrides = {}) {
  const { q: qOv = {}, qdot: qdotOv = {}, qddot: qddotOv = {} } = overrides;
  const q = new Array(size).fill(0);
  const qdot = new Array(size).fill(0);
  const qddot = new Array(size).fill(0);
  for (let i = 0; i < size; i += 1) {
    const id = REVOLUTE_IDS[i];
    if (id in qOv) q[i] = qOv[id];
    if (id in qdotOv) qdot[i] = qdotOv[id];
    if (id in qddotOv) qddot[i] = qddotOv[id];
  }
  return { q, qdot, qddot };
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */

describe("dynamics.full-body-rnea — 16-DOF humanoid", () => {
  it("vertical straight-leg standing: knee/thigh torques are ~0 (aligned axes)", () => {
    const tree = makeHumanoidTree();
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);  // all zeros
    const r = fullBodyRnea({ tree, q, qdot, qddot });

    assert.equal(r.status, "ok", r.reason);
    assert.equal(r.revoluteCount, 16);
    assert.equal(r.qLength, 16);

    // For aligned pitch joints in a vertically-balanced posture (q=0,
    // every link's COM lying in the y=0 plane), the gravity moment about
    // the joint's axis IS zero. We exclude left_foot / right_foot because
    // their COMs intentionally include a small y-offset (foot rolls
    // outward), so the foot sees a real ~m·g·0.05 N·m moment — physics
    // realism, not aligned axes.
    for (const id of ["left_hip", "right_hip", "left_thigh", "right_thigh", "left_shin", "right_shin"]) {
      const j = r.perJoint.find((p) => p.linkId === id);
      assert.ok(j, `expected perJoint entry for ${id}`);
      assert.ok(j.magnitudeNm < 1e-6,
        `${id} magnitudeNm=${j.magnitudeNm.toExponential(3)} should be < 1e-6 for vertical posture (q=0)`);
    }
  });

  it("arm extended horizontally: shoulder torque magnitude > 0.1 N·m", () => {
    const tree = makeHumanoidTree();
    // Rotate the LEFT shoulder about its pitch-x axis by π/2. This swings the arm
    // from hanging along -z (q=0) to extending horizontally along ±y. The arm
    // mass times gravity then produces a real moment about the shoulder axis.
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length, {
      q: { left_shoulder: Math.PI / 2 },
    });
    const r = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(r.status, "ok", r.reason);

    const shoulder = r.perJoint.find((p) => p.linkId === "left_shoulder");
    const arm = r.perJoint.find((p) => p.linkId === "left_arm");
    const hand = r.perJoint.find((p) => p.linkId === "left_hand");

    assert.ok(shoulder, "shoulder entry");
    assert.ok(shoulder.magnitudeNm > 0.1,
      `shoulder magnitudeNm=${shoulder.magnitudeNm.toFixed(4)} N·m should be > 0.1`);
    assert.ok(arm && arm.magnitudeNm > 0.0,
      `arm magnitude should also be > 0, got ${arm && arm.magnitudeNm}`);
    assert.ok(hand && hand.magnitudeNm > 0.0,
      `hand magnitude should also be > 0, got ${hand && hand.magnitudeNm}`);
  });

  it("region grouping: counts > 0 for torso, legs, and arms (and head)", () => {
    const tree = makeHumanoidTree();
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);
    const r = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(r.status, "ok", r.reason);

    assert.ok(r.regions.torso.count > 0, `torso.count=${r.regions.torso.count}`);
    assert.ok(r.regions.legs.count > 0, `legs.count=${r.regions.legs.count}`);
    assert.ok(r.regions.arms.count > 0, `arms.count=${r.regions.arms.count}`);
    assert.ok(r.regions.head.count > 0, `head.count=${r.regions.head.count}`);

    // Sanity: the per-joint region field matches what we expect.
    const head = r.perJoint.find((p) => p.linkId === "head");
    assert.equal(head.region, "head");
    const thigh = r.perJoint.find((p) => p.linkId === "left_thigh");
    assert.equal(thigh.region, "legs");
    const shoulder = r.perJoint.find((p) => p.linkId === "left_shoulder");
    assert.equal(shoulder.region, "arms");
  });

  it("totalVerticalForceN equals totalMassKg·G within 1e-6", () => {
    const tree = makeHumanoidTree();
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);
    const r = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(r.status, "ok", r.reason);

    // Hand-rolled mass sum for cross-check.
    let expectedMass = 0;
    for (const L of tree.links) expectedMass += (L.mass || 0);
    assert.ok(Math.abs(r.totalMassKg - expectedMass) < 1e-9,
      `totalMassKg=${r.totalMassKg} expected ${expectedMass}`);
    assert.ok(Math.abs(r.totalVerticalForceN - expectedMass * G) < 1e-6,
      `totalVerticalForceN=${r.totalVerticalForceN.toFixed(3)} expected ${(expectedMass * G).toFixed(3)}`);
    assert.ok(r.totalVerticalForceN > 0, "expected positive totalVerticalForceN");
  });

  it("forward-lean posture produces a non-zero horizontal gravity moment", () => {
    const tree = makeHumanoidTree();
    // Tilt the torso forward at the pelvis (q=0.4 rad ≈ 23°). Tilting rotates
    // every other link's COM away from the world z-axis, so each link's COM
    // now has horizontal (x,y) offset from the base origin and the gravity
    // moment has non-trivial x and y components.
    //
    // We tilt BOTH the hip and torso so that the upper-body COM offsets
    // accumulate.
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length, {
      q: { torso: 0.4, left_hip: 0.4, right_hip: 0.4 },
    });
    const r = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(r.status, "ok", r.reason);

    const gx = Math.abs(r.gravityMomentNm.x);
    const gy = Math.abs(r.gravityMomentNm.y);
    const mag = r.gravityMomentMagnitudeNm;
    assert.ok(gx > 1e-6,
      `gravityMomentNm.x should be non-zero for a forward lean, got x=${r.gravityMomentNm.x} y=${r.gravityMomentNm.y}`);
    assert.ok(mag > 1e-6,
      `gravityMomentMagnitudeNm should be > 1e-6, got ${mag}`);
    // Sanity: |x| and |y| from the magnitude should agree to within floating-point drift.
    assert.ok(Math.abs(mag - Math.hypot(gx, gy)) < 1e-9,
      `magnitude ${mag} should equal hypot(${gx}, ${gy})`);
  });

  it("q length mismatch returns not_computed with the counts named", () => {
    const tree = makeHumanoidTree();
    // Send q = [0] which is way shorter than 16 revolutes.
    const r = fullBodyRnea({ tree, q: [0], qdot: [0], qddot: [0] });
    assert.equal(r.status, "not_computed");
    assert.ok(typeof r.reason === "string" && r.reason.length > 0);
    // The reason string should spell out the counts of revolute joints and q length.
    assert.ok(/16/.test(r.reason),
      `reason should mention revoluteCount=16, got "${r.reason}"`);
    assert.ok(/1/.test(r.reason),
      `reason should mention qLength=1, got "${r.reason}"`);
    assert.equal(r.revoluteCount, 16);
    assert.equal(r.qLength, 1);
    assert.equal(r.perJoint.length, 0);
    assert.equal(r.totalMassKg, 0);
    assert.equal(r.totalVerticalForceN, 0);
    assert.equal(r.gravityMomentMagnitudeNm, 0);
    assert.equal(r.regions.legs.count, 0);
    assert.ok(r.angularMomentum.notComputed === true,
      "angularMomentum must be marked notComputed when status=not_computed");
  });

  it("tree missing → not_computed (missing field: tree)", () => {
    const r = fullBodyRnea({ q: [0] });
    assert.equal(r.status, "not_computed");
    assert.equal(r.revoluteCount, 0);
    assert.ok(/tree/i.test(r.reason), `expected reason to mention "tree", got "${r.reason}"`);
  });

  it("torqueLimitNm exceeded → status=fail and overLimitJoints listed", () => {
    const tree = makeHumanoidTree();
    // First, run without a limit to find the largest torque in the natural
    // standing posture.
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);
    const baseline = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(baseline.status, "ok", baseline.reason);

    // Then look at the extended-arm posture where torques are larger.
    const armPose = makePose(REVOLUTE_IDS.length, {
      q: { left_shoulder: Math.PI / 2 },
    });
    const armR = fullBodyRnea({ tree, q: armPose.q, qdot: armPose.qdot, qddot: armPose.qddot });
    assert.equal(armR.status, "ok", armR.reason);

    // Tight limit that the arm stresses will certainly exceed.
    const tightLimit = 0.5;  // N·m
    const limited = fullBodyRnea({
      tree,
      q: armPose.q,
      qdot: armPose.qdot,
      qddot: armPose.qddot,
      torqueLimitNm: tightLimit,
    });
    assert.equal(limited.status, "fail",
      `expected status=fail when the limit is below the largest |τ|`);
    assert.ok(limited.overLimitJoints.length > 0,
      "overLimitJoints should list at least one offending joint");
    // Verify that every listed id really does exceed the limit.
    for (const id of limited.overLimitJoints) {
      const j = limited.perJoint.find((p) => p.linkId === id);
      assert.ok(j, `listed id ${id} should be present in perJoint`);
      assert.ok(j.magnitudeNm > tightLimit,
        `listed ${id} magnitudeNm=${j.magnitudeNm} should exceed ${tightLimit}`);
    }
    // The remaining joints (if any) must be ≤ limit.
    const listed = new Set(limited.overLimitJoints);
    for (const j of limited.perJoint) {
      if (!listed.has(j.linkId)) {
        assert.ok(j.magnitudeNm <= tightLimit + 1e-9,
          `non-listed joint ${j.linkId} magnitudeNm=${j.magnitudeNm} should be ≤ ${tightLimit}`);
      }
    }
  });

  it("torqueLimitNm = null → never fails on missing data, only on missing torques; here all data is OK so status=ok", () => {
    const tree = makeHumanoidTree();
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);
    const r = fullBodyRnea({ tree, q, qdot, qddot, torqueLimitNm: null });
    assert.equal(r.status, "ok");
    assert.equal(r.torqueLimitNm, null);
    assert.equal(r.overLimitJoints.length, 0);
  });

  it("propagates inner RNEA notComputed reason verbatim (axis not unit-length)", () => {
    // Modify the tree to have a non-unit axis — this should make rneaSolver
    // return a notComputed, which our wrapper MUST copy verbatim.
    const tree = makeHumanoidTree();
    // Find the torso link and give it a bad axis [2,0,0] (length 2).
    for (const L of tree.links) if (L.id === "torso") L.axis = [2, 0, 0];
    const { q, qdot, qddot } = makePose(REVOLUTE_IDS.length);
    const r = fullBodyRnea({ tree, q, qdot, qddot });
    assert.equal(r.status, "not_computed");
    // The inner solver's message (or something clearly derived from the
    // axis-not-unit-length check) should be present.
    assert.ok(typeof r.reason === "string");
    assert.ok(/unit/i.test(r.reason) || /axis/i.test(r.reason),
      `expected verbatim inner reason mentioning axis/unit, got "${r.reason}"`);
  });
});
