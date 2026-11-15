import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhysicsActions from "../domains/physics.js";

// FIX-physics-004 — the Lab's energy readout. A 2 kg circle dropped in the
// default 800×600 box falls to the floor and bounces (restitution 0.7); the
// run used to report "0 collisions · energy drift −4,765 J", blaming the
// integrator for joules the bounces physically dissipated. The integrator
// itself is near-exact (free fall drifts −4 J in 15 s). These pins hold the
// honest accounting: wall impacts count as collisions, their restitution
// loss is reported as energyDissipated, and drift + dissipated ≈ the small
// integrator residual.

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
});

const ctx = { actor: { userId: "u" }, userId: "u" };
const BODY = { id: "b1", name: "Circle 1", type: "circle", x: 400, y: 100, vx: 0, vy: 0, mass: 2, radius: 24, restitution: 0.7, isStatic: false };
const SETTINGS = { gravityX: 0, gravityY: 9.81, airDensity: 0, restitutionGlobal: null, wallBounce: true, bounds: { w: 800, h: 600 } };

describe("physics — energy accounting (FIX-physics-004)", () => {
  it("the walker's drop: wall bounces count and their dissipation is reported", () => {
    const r = call("simulate-scene", ctx, { bodies: [BODY], constraints: [], fluids: [], settings: SETTINGS, steps: 900, substeps: 6 });
    assert.equal(r.ok, true);
    assert.ok(r.result.collisions > 0, `floor bounces must count as collisions, got ${r.result.collisions}`);
    assert.ok(r.result.energyDissipated > 4000, `bounces dissipate ~4.7 kJ, got ${r.result.energyDissipated}`);
    const residual = r.result.energyDrift + r.result.energyDissipated;
    assert.ok(Math.abs(residual) < 25, `integrator residual ${residual} J must stay small once dissipation is separated`);
  });

  it("true free fall (no walls) conserves energy and dissipates nothing", () => {
    const r = call("simulate-scene", ctx, {
      bodies: [{ ...BODY, y: 40 }], constraints: [], fluids: [],
      settings: { ...SETTINGS, wallBounce: false, bounds: { w: 800, h: 100000 } },
      steps: 900, substeps: 6,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.collisions, 0);
    assert.equal(r.result.energyDissipated, 0);
    assert.ok(Math.abs(r.result.energyDrift) < 10, `free-fall drift ${r.result.energyDrift} J`);
  });

  it("a perfectly elastic wall bounce counts as a collision but dissipates ~0", () => {
    const r = call("simulate-scene", ctx, {
      bodies: [{ ...BODY, restitution: 1 }], constraints: [], fluids: [], settings: SETTINGS, steps: 900, substeps: 6,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.collisions > 0);
    assert.ok(r.result.energyDissipated < 1, `elastic impacts dissipate nothing, got ${r.result.energyDissipated}`);
    assert.ok(Math.abs(r.result.energyDrift) < 25, `elastic run drift ${r.result.energyDrift} J`);
  });
});
