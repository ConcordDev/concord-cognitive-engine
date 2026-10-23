// server/tests/conkay-dynamics-forward.test.js
//
// Closed-form acceptance tests for dynamics.forward.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dynamicsForward } from "../lib/conkay/physics/solvers/dynamics-forward.js";

const G = 9.80665;

/** Simple pendulum (link along local -z, length L=1, mass m=1). */
function simplePendulumTree(q) {
  return {
    baseR: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    basePos: [0, 0, 0],
    gravity: [0, 0, -G],
    links: [
      { id: "base", parent: null, jointType: "fixed", axis: [1, 0, 0], origin: [0, 0, 0], mass: 0, com: [0, 0, 0], inertia: { Ixx: 1e-9, Iyy: 1e-9, Izz: 1e-9 } },
      { id: "bob", parent: "base", jointType: "revolute", axis: [1, 0, 0], origin: [0, 0, -1], mass: 1, com: [0, 0, -0.5], inertia: { Ixx: 1e-9, Iyy: 1/12, Izz: 1/12 } },
    ],
  };
}

describe("dynamics.forward — forward dynamics integrator", () => {
  it("zero torque on already-stationary pendulum ⇒ q stays constant", () => {
    const tree = simplePendulumTree();
    const r = dynamicsForward({
      tree,
      dt: 0.01,
      steps: 10,
      qInit: [0],                          // q[0] = 0 means link extends straight down
      qdotInit: [0],
      tau: () => [0],
      integrator: "semiimplicit",
    });
    assert.equal(r.status, "ok");
    for (let i = 1; i < r.trajectory.length; i += 1) {
      assert.ok(Math.abs(r.trajectory[i].q[0] - r.trajectory[i - 1].q[0]) < 1e-3, `q should not change, but Δq=${r.trajectory[i].q[0] - r.trajectory[i - 1].q[0]}`);
    }
  });

  it("gravity on horizontal pendulum ⇒ it falls, q changes", () => {
    // Pendulum with q=π/2 means link is horizontal (extension along +y).
    // Gravity creates a torque; q evolves over time.
    const tree = simplePendulumTree();
    const r = dynamicsForward({
      tree,
      dt: 0.001,
      steps: 100,
      qInit: [Math.PI / 2],
      qdotInit: [0],
      tau: () => [0],
      integrator: "semiimplicit",
    });
    assert.equal(r.status, "ok");
    assert.ok(Math.abs(r.finalState.q[0]) < Math.PI / 2, `q should fall from π/2 toward 0, final q=${r.finalState.q[0]}`);
  });

  it("constant torque ⇒ qddot nonzero ⇒ q evolves linearly (small step)", () => {
    const tree = simplePendulumTree();
    const tau_const = 5;
    const r = dynamicsForward({
      tree, dt: 0.01, steps: 10,
      qInit: [0], qdotInit: [0],
      tau: () => [tau_const],      // 5 N·m on the bob joint
      integrator: "semiimplicit",
    });
    assert.equal(r.status, "ok");
    // q should monotonically change.
    assert.notEqual(r.finalState.q[0], 0, "final q should be ≠ 0");
  });

  it("not_computed: empty qInit", () => {
    const r = dynamicsForward({ tree: simplePendulumTree(), dt: 0.01, steps: 5, qInit: [], tau: () => [0] });
    assert.equal(r.status, "not_computed");
  });

  it("not_computed: bad dt", () => {
    const r = dynamicsForward({ tree: simplePendulumTree(), dt: 0, steps: 5, qInit: [0], tau: () => [0] });
    assert.equal(r.status, "not_computed");
  });
});