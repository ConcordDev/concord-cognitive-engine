// server/tests/conkay-actuation-joint-torque.test.js
//
// Closed-form acceptance tests for actuation.joint-torque BEFORE it touches
// the humanoid. We use a single pendulum with a clear actuator spec so the
// pass / fail outcomes can be verified by direct calculation.
//
// Cases:
//   1. Well within continuous spec: ok with margin
//   2. Above continuous but within peak: warn (utilisation > continuous threshold)
//   3. Above peak: fail
//   4. Missing datasheet: every check not_computed; aggregate not_computed
//   5. NOT_COMPUTED for invalid inputs (no tree, no spec)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rneaSolver, partsToChain } from "../lib/conkay/physics/solvers/dynamics-inverse.js";
import { actuationJointTorque } from "../lib/conkay/physics/solvers/actuation-joint-torque.js";

const G = 9.80665;

function mkI(a, b, c) { return { Ixx: a, Iyy: b, Izz: c }; }

function pendulumTree() {
  return {
    baseR: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    basePos: [0, 0, 1],
    gravity: [0, 0, -G],
    links: [
      { id: "base", parent: null, jointType: "fixed", axis: [1, 0, 0], origin: [0, 0, 0], mass: 0, com: [0, 0, 0], inertia: mkI(0, 0, 0) },
      { id: "L1", parent: "base", jointType: "revolute", axis: [1, 0, 0], origin: [0, 0, 0], mass: 1, com: [0, 0, 0.5], inertia: mkI(1 / 3, 0, 1 / 3) },
    ],
  };
}

describe("actuation.joint-torque — feasibility screening", () => {
  it("well within continuous spec → ok with margin", () => {
    // Pendulum tree has com=[0,0,0.5] ⇒ half-length L/2 = 0.5 m from joint to COM.
    // τ_required = G·mass·(L/2)·sin(q) = 9.81·1·0.5·sin(π/4) ≈ 3.47 N·m.
    // Actuator: continuous 50 N·m, peak 100 N·m, speedMax 2π rad/s.
    const tree = pendulumTree();
    const q = [Math.PI / 4], qdot = [0], qddot = [0];
    const rnea = rneaSolver({ tree, gravity: [0, 0, -G], q, qdot, qddot, fixedBase: true });
    const requiredNm = rnea.torques.find((t) => t.linkId === "L1").torqueNm;
    const spec = { L1: { torqueContinuousNm: 50, torquePeakNm: 100, speedMaxRadps: 2 * Math.PI } };
    assert.ok(Math.abs(Math.abs(requiredNm) - 3.47) < 0.05, `rnea check: expected ~3.47, got ${requiredNm.toFixed(4)}`);
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot, actuatorSpec: spec,
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.torqueContinuous.status, "ok");
    assert.equal(j.checks.torquePeak.status, "ok");
    assert.ok(j.checks.torqueContinuous.marginNm > 40, "should have >40 N·m margin");
  });

  it("above continuous but within peak → fail continuous, ok on peak", () => {
    // τ_required = G·m·(L/2)·sin(π/2) = 9.81·m·0.5
    // For 9.81·m·0.5 = 78.5 ⇒ m = 16 kg
    const tree = pendulumTree();
    tree.links[1].mass = 16;  // τ_required = 9.81·16·0.5·1 = 78.5 N·m
    tree.links[1].inertia = mkI(16 / 3, 0, 16 / 3);
    const q = [Math.PI / 2], qdot = [0], qddot = [0];
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: { L1: { torqueContinuousNm: 50, torquePeakNm: 100, speedMaxRadps: 2 * Math.PI } },
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.torqueContinuous.status, "fail", "78.5 > 50 → fail continuous");
    assert.equal(j.checks.torquePeak.status, "ok", "78.5 < 100 → ok peak");
  });

  it("above peak → fail peak AND continuous", () => {
    // τ_required = 9.81·m·0.5 = 196 ⇒ m = 40 kg
    const tree = pendulumTree();
    tree.links[1].mass = 40;
    tree.links[1].inertia = mkI(40 / 3, 0, 40 / 3);
    const q = [Math.PI / 2], qdot = [0], qddot = [0];
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: { L1: { torqueContinuousNm: 50, torquePeakNm: 100, speedMaxRadps: 2 * Math.PI } },
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.torquePeak.status, "fail", "196 > 100 → fail peak");
    assert.equal(j.checks.torqueContinuous.status, "fail", "196 > 50 → fail continuous");
  });

  it("missing datasheet → not_computed, NOT a guessed pass", () => {
    const tree = pendulumTree();
    const q = [Math.PI / 4], qdot = [0], qddot = [0];
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: {},        // empty spec ⇒ no actuator for L1
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.torqueContinuous.status, "not_computed");
    assert.equal(j.checks.torquePeak.status, "not_computed");
    assert.equal(j.checks.speedLimit.status, "not_computed");
    // Aggregate: every check not_computed ⇒ overall not_computed
    assert.equal(j.status, "not_computed");
  });

  it("speed envelope fails above speedMax", () => {
    const tree = pendulumTree();
    const q = [Math.PI / 4], qdot = [10], qddot = [0];  // qdot=10 > speedMax=2π
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: { L1: { torqueContinuousNm: 50, torquePeakNm: 100, speedMaxRadps: 2 * Math.PI } },
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.speedLimit.status, "fail", "10 > 2π");
  });

  it("partial datasheet → only the checks with data are evaluated", () => {
    const tree = pendulumTree();
    const q = [Math.PI / 4], qdot = [0], qddot = [0];
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: { L1: { torqueContinuousNm: 50 } },  // only continuous
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.equal(j.checks.torqueContinuous.status, "ok");
    assert.equal(j.checks.torquePeak.status, "not_computed");
    assert.equal(j.checks.speedLimit.status, "not_computed");
  });

  it("NOT_COMPUTED when actuatorSpec is missing", () => {
    const tree = pendulumTree();
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: [0], qdot: [0], qddot: [0],
    });
    assert.ok(r && r.notComputed, `expected notComputed envelope, got ${JSON.stringify(r).slice(0, 200)}`);
  });

  it("reject non-unit axis in tree", () => {
    // The rneaSolver returns notComputed for non-unit axis; screening inherits.
    const tree = pendulumTree();
    tree.links[1].axis = [1, 0, 0, 0];  // 4-vector
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: [0], qdot: [0], qddot: [0],
      actuatorSpec: { L1: { torqueContinuousNm: 50 } },
    });
    // Either the frame is notComputed, or the whole result is. Either is honest.
    if (r.find) {
      const f = r.find((x) => x.t === 0);
      assert.ok(!f || f.status === "not_computed", "expected notComputed");
    } else {
      assert.ok(r.notComputed);
    }
  });

  it("speed-dependent torque derate: at full speed envelope, torque is 0", () => {
    // At ω = ωMax the linear derate yields 0. Required > 0 → fail.
    const tree = pendulumTree();
    const q = [Math.PI / 4], qdot = [2 * Math.PI - 0.001], qddot = [0];  // essentially at speedMax
    const r = actuationJointTorque({
      tree, gravity: [0, 0, -G], pose: q, qdot, qddot,
      actuatorSpec: { L1: { torqueContinuousNm: 50, torquePeakNm: 100, speedMaxRadps: 2 * Math.PI } },
    });
    const j = r.find((f) => f.t === 0).perJoint.find((x) => x.linkId === "L1");
    assert.ok(j.checks.torqueSpeedDerate.limitNm < 1, `expected derate limit ≈0, got ${j.checks.torqueSpeedDerate.limitNm}`);
  });
});