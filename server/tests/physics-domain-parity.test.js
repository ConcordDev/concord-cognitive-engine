import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhysicsActions from "../domains/physics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`physics.${name}`);
  if (!fn) throw new Error(`physics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPhysicsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctx = { actor: { userId: "u" }, userId: "u" };

describe("physics — kinematics 1D", () => {
  it("free fall from rest for 2s: v=19.62, x=19.62", () => {
    const r = call("kinematics-1d", ctx, { v0: 0, a: 9.81, t: 2 });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.solved.v - 19.62) < 0.01);
    assert.ok(Math.abs(r.result.solved.x - 19.62) < 0.01);
  });

  it("v² = v₀² + 2ax", () => {
    const r = call("kinematics-1d", ctx, { v0: 0, a: 9.81, x: 10 });
    // v = sqrt(2 * 9.81 * 10) = 14.007
    assert.ok(Math.abs(r.result.solved.v - 14.007) < 0.05);
  });

  it("rejects fewer than 3 inputs", () => {
    const r = call("kinematics-1d", ctx, { v0: 0, t: 2 });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 3/);
  });
});

describe("physics — projectile motion", () => {
  it("45° at 20 m/s from ground gives range ≈ 40.77m", () => {
    const r = call("projectile", ctx, { v0: 20, angleDeg: 45, h0: 0 });
    assert.equal(r.ok, true);
    // R = v₀² sin(2θ) / g = 400 * 1 / 9.81 = 40.77
    assert.ok(Math.abs(r.result.range_m - 40.77) < 0.5);
  });

  it("max height for vertical launch", () => {
    const r = call("projectile", ctx, { v0: 30, angleDeg: 90, h0: 0 });
    // h = v² / 2g = 900 / 19.62 = 45.87
    assert.ok(Math.abs(r.result.maxHeight_m - 45.87) < 0.5);
  });

  it("rejects v0 = 0", () => {
    const r = call("projectile", ctx, { v0: 0, angleDeg: 30 });
    assert.equal(r.ok, false);
  });

  it("rejects angle > 90", () => {
    const r = call("projectile", ctx, { v0: 10, angleDeg: 100 });
    assert.equal(r.ok, false);
  });
});

describe("physics — unit conversion", () => {
  it("1 m = 3.28084 ft", () => {
    const r = call("convert-units", ctx, { value: 1, from: "m", to: "ft", kind: "length" });
    assert.ok(Math.abs(r.result.result - 3.28084) < 0.001);
  });

  it("1 kg = 2.20462 lb", () => {
    const r = call("convert-units", ctx, { value: 1, from: "kg", to: "lb", kind: "mass" });
    assert.ok(Math.abs(r.result.result - 2.20462) < 0.001);
  });

  it("100°C = 212°F", () => {
    const r = call("convert-units", ctx, { value: 100, from: "C", to: "F", kind: "temperature" });
    assert.ok(Math.abs(r.result.result - 212) < 0.01);
  });

  it("0K = -273.15°C", () => {
    const r = call("convert-units", ctx, { value: 0, from: "K", to: "C", kind: "temperature" });
    assert.ok(Math.abs(r.result.result - (-273.15)) < 0.01);
  });

  it("rejects unknown kind", () => {
    const r = call("convert-units", ctx, { value: 1, from: "x", to: "y", kind: "bogus" });
    assert.equal(r.ok, false);
  });
});

describe("physics — constants", () => {
  it("returns expected constants", () => {
    const r = call("constants", ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.constants.c.value, 299_792_458);
    assert.ok(r.result.constants.G.value > 0);
    assert.ok(r.result.constants.h.value > 0);
  });
});
