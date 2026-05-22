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

describe("physics — scene CRUD + share", () => {
  it("saves, lists, gets, and deletes a scene", () => {
    const save = call("scene-save", ctx, {
      name: "Test Scene",
      bodies: [{ type: "circle", x: 100, y: 100, mass: 2 }],
      constraints: [],
      fluids: [],
    });
    assert.equal(save.ok, true);
    const id = save.result.scene.id;
    assert.ok(id);
    assert.equal(save.result.scene.bodies.length, 1);

    const list = call("scene-list", ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.scenes.some((s) => s.id === id));

    const get = call("scene-get", ctx, { id });
    assert.equal(get.ok, true);
    assert.equal(get.result.scene.name, "Test Scene");

    const del = call("scene-delete", ctx, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
  });

  it("rejects scene-get for missing id", () => {
    const r = call("scene-get", ctx, { id: "nope" });
    assert.equal(r.ok, false);
  });

  it("creates a share code and loads a shared scene", () => {
    const save = call("scene-save", ctx, {
      name: "Shared",
      bodies: [{ type: "circle", x: 50, y: 50 }],
    });
    const id = save.result.scene.id;
    const share = call("scene-share", ctx, { id });
    assert.equal(share.ok, true);
    assert.ok(share.result.shareCode);
    assert.match(share.result.embed, /scene=/);

    const loaded = call("scene-load-shared", ctx, { shareCode: share.result.shareCode });
    assert.equal(loaded.ok, true);
    assert.match(loaded.result.scene.name, /imported/);
  });

  it("rejects scene-load-shared with bad code", () => {
    const r = call("scene-load-shared", ctx, { shareCode: "phxbogus" });
    assert.equal(r.ok, false);
  });
});

describe("physics — simulate-scene", () => {
  it("steps a free-fall scene and returns time-series + energy trace", () => {
    const r = call("simulate-scene", ctx, {
      bodies: [{ id: "b1", type: "circle", x: 400, y: 100, mass: 2, radius: 20 }],
      settings: { gravityY: 9.81, wallBounce: true },
      steps: 120,
      substeps: 4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.bodies.length, 1);
    assert.ok(r.result.bodies[0].series.length > 0);
    assert.ok(r.result.energyTrace.length > 0);
    // body fell under gravity
    assert.ok(r.result.bodies[0].final.y > 100);
  });

  it("rejects an empty scene", () => {
    const r = call("simulate-scene", ctx, { bodies: [] });
    assert.equal(r.ok, false);
  });

  it("runs a persisted scene by id", () => {
    const save = call("scene-save", ctx, {
      name: "Runnable",
      bodies: [{ id: "x", type: "circle", x: 200, y: 100, mass: 1, radius: 15 }],
    });
    const r = call("scene-run", ctx, { id: save.result.scene.id, steps: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "Runnable");
    assert.ok(r.result.energyTrace.length > 0);
  });

  it("simulates spring constraint + fluid buoyancy", () => {
    const r = call("simulate-scene", ctx, {
      bodies: [
        { id: "anchor", type: "fixed", x: 400, y: 100 },
        { id: "mass", type: "circle", x: 400, y: 300, mass: 3, radius: 20 },
      ],
      constraints: [{ type: "spring", a: "anchor", b: "mass", restLength: 120, stiffness: 0.5 }],
      fluids: [{ id: "tank", x: 200, y: 400, w: 400, h: 200, density: 1, drag: 0.5 }],
      steps: 200,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.bodies.length === 2);
  });
});

describe("physics — measurement tools", () => {
  it("ruler measures distance + angle", () => {
    const r = call("measure", ctx, {
      tool: "ruler",
      a: { x: 0, y: 0 },
      b: { x: 150, y: 0 },
      pixelsPerMeter: 50,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.meters, 3);
    assert.equal(r.result.angleDeg, 0);
  });

  it("protractor measures an angle", () => {
    const r = call("measure", ctx, {
      tool: "protractor",
      vertex: { x: 0, y: 0 },
      a: { x: 100, y: 0 },
      b: { x: 0, y: 100 },
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.interiorDeg - 90) < 0.01);
  });

  it("force tool resolves net force on a body", () => {
    const r = call("measure", ctx, { tool: "force", mass: 2, gravity: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.components.fy, 20);
    assert.equal(r.result.acceleration, 10);
  });

  it("rejects unknown measurement tool", () => {
    const r = call("measure", ctx, { tool: "bogus" });
    assert.equal(r.ok, false);
  });
});

describe("physics — curriculum modules", () => {
  it("lists curriculum modules", () => {
    const r = call("curriculum-list", ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.modules.length >= 5);
    assert.ok(r.result.modules.every((m) => m.id && m.title && m.stepCount > 0));
  });

  it("gets a curriculum module with a runnable scene", () => {
    const r = call("curriculum-get", ctx, { id: "pendulum-lab" });
    assert.equal(r.ok, true);
    assert.equal(r.result.module.id, "pendulum-lab");
    assert.ok(r.result.module.scene.bodies.length > 0);
    assert.ok(r.result.module.steps.length > 0);
  });

  it("rejects unknown module id", () => {
    const r = call("curriculum-get", ctx, { id: "nope" });
    assert.equal(r.ok, false);
  });

  it("computes pendulum period", () => {
    const r = call("pendulum-period", ctx, { length: 1, gravity: 9.81 });
    assert.equal(r.ok, true);
    // T = 2π√(L/g) = 2.006s
    assert.ok(Math.abs(r.result.smallAnglePeriod_s - 2.006) < 0.01);
  });

  it("rejects pendulum with non-positive length", () => {
    const r = call("pendulum-period", ctx, { length: 0 });
    assert.equal(r.ok, false);
  });
});
