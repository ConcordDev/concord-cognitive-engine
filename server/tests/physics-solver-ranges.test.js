// server/tests/physics-solver-ranges.test.js
//
// FIX-physics-003: the solvers accepted non-physical inputs silently —
// a 300-digit kinematics value came back as v = 1e+300 m/s, and a
// projectile body with mass -2 flew FARTHER than at mass 1 because the
// drag acceleration divides by mass (a negative mass flips drag into
// thrust). Both surfaces now refuse out-of-range input BY NAME.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerPhysicsActions from "../domains/physics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, artifact, params) {
  const fn = ACTIONS.get(`physics.${name}`);
  if (!fn) throw new Error(`${name} not registered`);
  return fn({ actor: { userId: "u1" }, userId: "u1" }, artifact || { id: null, data: {}, meta: {} }, params || {});
}

before(() => { registerPhysicsActions(register); });

describe("physics solver input ranges (FIX-physics-003)", () => {
  it("kinematics-1d refuses a 300-digit-scale input by name", () => {
    const r = call("kinematics-1d", null, { v0: 1e300, a: 9.81, t: 2 });
    assert.equal(r.ok, false);
    assert.match(r.error, /v0 is out of range/);
  });

  it("kinematics-1d refuses non-finite input by name", () => {
    const r = call("kinematics-1d", null, { v0: "abc", a: 9.81, t: 2, x: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /v0 is out of range/);
  });

  it("kinematics-1d refuses when in-range inputs solve out of range", () => {
    // v0 = a = 1e12 (in range); x = v0*t + ½at² with t = 1e6 → ~5e23.
    const r = call("kinematics-1d", null, { v0: 1e12, a: 1e12, t: 1e6 });
    assert.equal(r.ok, false);
    assert.match(r.error, /solved .* is out of range/);
  });

  it("kinematics-1d still solves ordinary problems", () => {
    const r = call("kinematics-1d", null, { v0: 0, a: 9.81, t: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.solved.v, 19.62);
    assert.equal(r.result.solved.x, 19.62);
  });

  it("projectile-with-drag refuses a negative mass, naming the body", () => {
    const body = { name: "ball", mass: -2, position: { x: 0, y: 1, z: 0 }, velocity: { x: 28, y: 23, z: 0 }, dragCoefficient: 0.35, crossSection: 0.0042 };
    const r = call("kinematicsSimAdvanced", { id: null, data: { bodies: [body] }, meta: {} }, { dt: 0.005, steps: 6000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /body "ball": mass must be > 0/);
  });

  it("projectile-with-drag refuses a zero mass and a non-finite velocity", () => {
    const zero = { name: "ghost", mass: 0, position: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 1, z: 0 } };
    assert.equal(call("kinematicsSimAdvanced", { id: null, data: { bodies: [zero] }, meta: {} }, {}).ok, false);
    const bad = { name: "bad", mass: 1, position: { x: 0, y: 1, z: 0 }, velocity: { x: Infinity, y: 1, z: 0 } };
    const r = call("kinematicsSimAdvanced", { id: null, data: { bodies: [bad] }, meta: {} }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /velocity\.x must be a finite number/);
  });

  it("the drag engine still flies the audit's comparison correctly at m=1", () => {
    const mk = (cd) => ({ name: "b", mass: 1, position: { x: 0, y: 1, z: 0 }, velocity: { x: 28, y: 23, z: 0 }, dragCoefficient: cd, crossSection: 0.0042 });
    const withDrag = call("kinematicsSimAdvanced", { id: null, data: { bodies: [mk(0.35)] }, meta: {} }, { dt: 0.005, steps: 6000 });
    const noDrag = call("kinematicsSimAdvanced", { id: null, data: { bodies: [mk(0)] }, meta: {} }, { dt: 0.005, steps: 6000 });
    assert.equal(withDrag.ok, true);
    assert.ok(withDrag.result.bodies[0].range < noDrag.result.bodies[0].range, "drag must shorten the range, never extend it");
  });
});
