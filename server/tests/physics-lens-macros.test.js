// Behavioral macro tests for server/domains/physics.js — the physicist's
// reference bench the /lenses/physics surface drives.
//
// COMPLEMENT to physics-domain-parity.test.js (which pins kinematics/projectile/
// orbital/wave/thermo/scene math on the LENS_ACTIONS path). This file is the
// PHASE-2 GATE for the four pure-compute calculators the live components call —
// PhysicsActionPanel.tsx and PhysicsWorkbench.tsx both POST /api/lens/run with
// { domain:'physics', action, input } → LENS_ACTIONS dispatch (server.js:39285):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, params)` — the 3-ARG convention,
// with virtualArtifact.data === params === body.input. Our harness mirrors that
// EXACTLY so a regression that confuses the param positions surfaces here.
//
// COMPONENT-EXACT-SHAPE: every case below drives the EXACT inner-data object the
// component sends (kinematics {v0,v,a,t,x}; projectile {v0,angleDeg,h0,g};
// convert-units {value,from,to,kind}; constants {}) and asserts the EXACT fields
// the component renders from `r.result` (kin → result.solved.{v0,v,a,t,x} +
// result.equations; projectile → range_m/maxHeight_m/timeOfFlight_s/
// timeToApex_s/impactSpeed_mps/v0x_mps/v0y_mps; convert → result.{value,from,to,
// kind,result}; constants → result.constants[sym].{value,units,name}). These
// are NOT shape-only assertions — each feeds KNOWN inputs and asserts the EXACT
// computed value so the physics math is pinned, not merely "ok:true".
//
// CORRECTNESS SCRUTINY (fail-CLOSED poisoned-numeric): these are pure calculators
// (no wallet, no minting), so the risk is fail-OPEN non-finite output. The domain
// guards every numeric input via `Number(...)` + `Number.isFinite(...)`:
// `Number("1e999")` and `Number("Infinity")` both yield Infinity (NOT finite), so
// a poisoned value is REJECTED (ok:false) rather than flowing into a computed
// result as Infinity/NaN. The poisoned-numeric block pins this for all four.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhysicsActions from "../domains/physics.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "physics", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch EXACTLY: handler(ctx, virtualArtifact, params) with
// virtualArtifact.data === params === body.input (server.js:39287-39288).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`physics.${name} not registered`);
  const virtualArtifact = { id: null, domain: "physics", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerPhysicsActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

// The four pure-compute calculators the live components POST to /api/lens/run.
const CALC_MACROS = ["kinematics-1d", "projectile", "convert-units", "constants"];

describe("physics — registration (every component-driven calculator present)", () => {
  it("registers each calculator the page + components call", () => {
    for (const m of CALC_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing physics.${m}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kinematics-1d — PhysicsActionPanel.actKin / PhysicsWorkbench.KinematicsTab
//   sends: { v0, v, a, t, x } (only non-empty fields)
//   renders: result.solved.{v0,v,a,t,x}, result.equations[], result.units
// ─────────────────────────────────────────────────────────────────────────────
describe("physics.kinematics-1d — component-exact shape + real values", () => {
  it("free-fall from rest 2s → solved.v=19.62, solved.x=19.62 (exact rendered fields)", () => {
    // The Workbench default tab sends exactly this shape (v0/a/t filled).
    const r = call("kinematics-1d", ctx, { v0: 0, a: 9.81, t: 2 });
    assert.equal(r.ok, true);
    // Component reads r.result.solved[k] for k in v0/v/a/t/x — assert those exact keys.
    assert.ok(r.result.solved && typeof r.result.solved === "object");
    assert.ok(Math.abs(r.result.solved.v - 19.62) < 0.001, `v=${r.result.solved.v}`);
    assert.ok(Math.abs(r.result.solved.x - 19.62) < 0.001, `x=${r.result.solved.x}`);
    assert.equal(r.result.solved.v0, 0);
    assert.equal(r.result.solved.a, 9.81);
    assert.equal(r.result.solved.t, 2);
    // Component renders result.equations.join(' · ') — must be a non-empty array.
    assert.ok(Array.isArray(r.result.equations) && r.result.equations.length === 4);
    // units block the ActionPanel/Workbench may surface
    assert.equal(r.result.units.x, "m");
  });

  it("v² = v₀² + 2ax solves v from {v0,a,x}", () => {
    const r = call("kinematics-1d", ctx, { v0: 0, a: 9.81, x: 10 });
    assert.equal(r.ok, true);
    // v = sqrt(2 * 9.81 * 10) = 14.0071...
    assert.ok(Math.abs(r.result.solved.v - 14.0071) < 0.01, `v=${r.result.solved.v}`);
  });

  it("solves t and a from {v0,v,t}-style overdetermined set deterministically", () => {
    // v=20, v0=0, t=2 → a = 10, x = 20
    const r = call("kinematics-1d", ctx, { v0: 0, v: 20, t: 2 });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.solved.a - 10) < 0.001, `a=${r.result.solved.a}`);
    assert.ok(Math.abs(r.result.solved.x - 20) < 0.001, `x=${r.result.solved.x}`);
  });

  it("validation-rejection: fewer than 3 of {v0,v,a,t,x} → ok:false with string error", () => {
    const r = call("kinematics-1d", ctx, { v0: 0, t: 2 });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
    assert.match(r.error, /at least 3/);
  });

  it("degrade-graceful: empty input → ok:false (not a throw, not a fabricated solve)", () => {
    const r = call("kinematics-1d", ctx, {});
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("fail-CLOSED poisoned-numeric: '1e999'/'Infinity'/'NaN' do not become finite outputs", () => {
    // Poisoned values collapse to Infinity/NaN under Number(...) and are filtered
    // by Number.isFinite, dropping the provided-count below 3 → rejected.
    const r = call("kinematics-1d", ctx, { v0: "1e999", a: "Infinity", t: "NaN" });
    assert.equal(r.ok, false, "poisoned trio must be rejected, never solved to Infinity");
    // And a poisoned value mixed with two real ones must never leak a non-finite solve.
    const r2 = call("kinematics-1d", ctx, { v0: 0, a: 9.81, t: "1e999" });
    if (r2.ok) {
      for (const k of ["v0", "v", "a", "t", "x"]) {
        const val = r2.result.solved[k];
        assert.ok(val == null || Number.isFinite(val), `solved.${k}=${val} must be null or finite`);
      }
    } else {
      assert.equal(typeof r2.error, "string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// projectile — PhysicsActionPanel.actProj / PhysicsWorkbench.ProjectileTab
//   sends: { v0, angleDeg, h0, g? }
//   renders: range_m, maxHeight_m, timeOfFlight_s, timeToApex_s,
//            impactSpeed_mps, v0x_mps, v0y_mps
// ─────────────────────────────────────────────────────────────────────────────
describe("physics.projectile — component-exact shape + real values", () => {
  it("45° at 20 m/s from ground → range≈40.77m (exact rendered fields)", () => {
    // ActionPanel sends {v0, angleDeg, h0, g:9.81}; Workbench omits g (defaults 9.81).
    const r = call("projectile", ctx, { v0: 20, angleDeg: 45, h0: 0, g: 9.81 });
    assert.equal(r.ok, true);
    // R = v₀² sin(2θ)/g = 400/9.81 = 40.77
    assert.ok(Math.abs(r.result.range_m - 40.77) < 0.05, `range=${r.result.range_m}`);
    // Every field the components render must be present + finite.
    for (const k of ["timeOfFlight_s", "range_m", "maxHeight_m", "timeToApex_s", "impactSpeed_mps", "v0x_mps", "v0y_mps"]) {
      assert.ok(Number.isFinite(r.result[k]), `missing/non-finite result.${k}`);
    }
    // v0x = v0y = 20*cos45 = 14.14 at 45°
    assert.ok(Math.abs(r.result.v0x_mps - 14.14) < 0.05, `v0x=${r.result.v0x_mps}`);
    assert.ok(Math.abs(r.result.v0y_mps - 14.14) < 0.05, `v0y=${r.result.v0y_mps}`);
  });

  it("vertical launch (90°) → maxHeight ≈ 45.87m, range ≈ 0", () => {
    const r = call("projectile", ctx, { v0: 30, angleDeg: 90, h0: 0, g: 9.81 });
    assert.equal(r.ok, true);
    // h = v²/2g = 900/19.62 = 45.87
    assert.ok(Math.abs(r.result.maxHeight_m - 45.87) < 0.05, `h=${r.result.maxHeight_m}`);
    assert.ok(Math.abs(r.result.range_m) < 0.01, `range=${r.result.range_m}`);
  });

  it("launch from height h0 extends flight time + range", () => {
    const ground = call("projectile", ctx, { v0: 20, angleDeg: 45, h0: 0 });
    const cliff = call("projectile", ctx, { v0: 20, angleDeg: 45, h0: 10 });
    assert.equal(cliff.ok, true);
    assert.ok(cliff.result.timeOfFlight_s > ground.result.timeOfFlight_s);
    assert.ok(cliff.result.range_m > ground.result.range_m);
  });

  it("validation-rejection: v0<=0 → ok:false", () => {
    const r = call("projectile", ctx, { v0: 0, angleDeg: 30 });
    assert.equal(r.ok, false);
    assert.match(r.error, /v0 must be > 0/);
  });

  it("validation-rejection: angleDeg out of 0..90 → ok:false", () => {
    const r = call("projectile", ctx, { v0: 20, angleDeg: 120 });
    assert.equal(r.ok, false);
    assert.match(r.error, /angleDeg/);
  });

  it("degrade-graceful: empty input → ok:false (not a throw)", () => {
    const r = call("projectile", ctx, {});
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("fail-CLOSED poisoned-numeric: '1e999' v0 / 'NaN' angle rejected, no Infinity range", () => {
    const r = call("projectile", ctx, { v0: "1e999", angleDeg: 45 });
    assert.equal(r.ok, false, "Infinity v0 must be rejected");
    const r2 = call("projectile", ctx, { v0: 20, angleDeg: "NaN" });
    assert.equal(r2.ok, false, "NaN angle must be rejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convert-units — PhysicsActionPanel.actUnit / PhysicsWorkbench.UnitsTab
//   sends: { value, from, to, kind }
//   renders: result.{value, from, to, kind, result}
// ─────────────────────────────────────────────────────────────────────────────
describe("physics.convert-units — component-exact shape + real values", () => {
  it("1 m → 3.28084 ft (exact rendered fields)", () => {
    const r = call("convert-units", ctx, { value: 1, from: "m", to: "ft", kind: "length" });
    assert.equal(r.ok, true);
    // 1 / 0.3048 = 3.28084
    assert.ok(Math.abs(r.result.result - 3.28084) < 0.0001, `result=${r.result.result}`);
    // Component renders value/from/to/kind verbatim from r.result.
    assert.equal(r.result.value, 1);
    assert.equal(r.result.from, "m");
    assert.equal(r.result.to, "ft");
    assert.equal(r.result.kind, "length");
  });

  it("temperature: 100 C → 212 F (special-cased path)", () => {
    const r = call("convert-units", ctx, { value: 100, from: "C", to: "F", kind: "temperature" });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.result - 212) < 0.0001, `result=${r.result.result}`);
  });

  it("velocity: 100 kmh → 27.7778 mps", () => {
    const r = call("convert-units", ctx, { value: 100, from: "kmh", to: "mps", kind: "velocity" });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.result - 27.7778) < 0.01, `result=${r.result.result}`);
  });

  it("validation-rejection: unknown kind → ok:false", () => {
    const r = call("convert-units", ctx, { value: 1, from: "m", to: "ft", kind: "luminance" });
    assert.equal(r.ok, false);
    assert.match(r.error, /kind must be one of/);
  });

  it("validation-rejection: unknown from-unit → ok:false", () => {
    const r = call("convert-units", ctx, { value: 1, from: "furlong", to: "ft", kind: "length" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown from unit/);
  });

  it("degrade-graceful: missing value → ok:false", () => {
    const r = call("convert-units", ctx, { from: "m", to: "ft", kind: "length" });
    assert.equal(r.ok, false);
    assert.match(r.error, /value required/);
  });

  it("fail-CLOSED poisoned-numeric: '1e999' / 'Infinity' value rejected", () => {
    const r = call("convert-units", ctx, { value: "1e999", from: "m", to: "ft", kind: "length" });
    assert.equal(r.ok, false, "Infinity value must be rejected, never converted");
    const r2 = call("convert-units", ctx, { value: "Infinity", from: "C", to: "F", kind: "temperature" });
    assert.equal(r2.ok, false, "Infinity temp must be rejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// constants — PhysicsActionPanel.actConst / PhysicsWorkbench.ConstantsTab
//   sends: {}
//   renders: result.constants[sym].{value, units, name}
// ─────────────────────────────────────────────────────────────────────────────
describe("physics.constants — component-exact shape + real values", () => {
  it("returns the constants map with {value,units,name} per symbol", () => {
    const r = call("constants", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.constants && typeof r.result.constants === "object");
    // Component renders constants[k].value.toExponential(...) + .units + .name.
    for (const [sym, c] of Object.entries(r.result.constants)) {
      assert.ok(Number.isFinite(c.value), `constants.${sym}.value non-finite`);
      assert.equal(typeof c.units, "string");
      assert.equal(typeof c.name, "string");
    }
  });

  it("speed of light is exactly 299792458 m/s", () => {
    const r = call("constants", ctx, {});
    assert.equal(r.result.constants.c.value, 299_792_458);
    assert.equal(r.result.constants.c.units, "m/s");
  });

  it("degrade-graceful: ignores garbage input, still returns the map", () => {
    const r = call("constants", ctx, { junk: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.constants.G.value));
  });
});
