/**
 * SX-XC-01 solver.select fidelity-router tests.
 *
 * The catalogue reference case is the spine: engine absent → the top
 * tier is NOT_COMPUTED engine_unavailable and the labelled fast path
 * rides beside it; a solver whose only tiers need the absent engine
 * returns NOT_COMPUTED with no outputs at all — never a fallback
 * number labelled as the engine tier's result.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerSolver } from "../../lib/conkay/physics/registry.js";
import { defineEngine, _clearEngines } from "../../lib/conkay/engines/manifest.js";
import {
  registerTier, selectTier, runSelected, listTieredSolvers, _clearTiers,
} from "../../lib/conkay/select.js";

const double = (factor) => async (ctx) => ({
  inputs: { x: ctx.inputs.x },
  outputs: { y: ctx.inputs.x * factor },
  margins: [],
});

function setup() {
  _clearTiers();
  _clearEngines();
  defineEngine({
    id: "present-engine", version: "1.0.0", licence: "MIT", linkMode: "process",
    envVar: "PRESENT_ENGINE_BIN", defaultPath: process.execPath,
    healthOp: "health", ops: ["health"], kernel: import.meta.filename,
    installHint: "test fixture (node itself)",
  });
  defineEngine({
    id: "absent-engine", version: "2.0.0", licence: "MIT", linkMode: "process",
    envVar: "ABSENT_ENGINE_BIN", defaultPath: "/nonexistent/absent-engine",
    healthOp: "health", ops: ["health"], kernel: import.meta.filename,
    installHint: "install the absent engine",
  });
  // math.fixture: L1 in-process fast path, L3 on the absent engine.
  registerSolver({
    id: "math.fixture", version: "1.0.0", domain: "math", method: "fixture",
    targets: ["value"], fidelity: 1, run: double(2),
  });
  registerTier({
    solverId: "math.fixture", tier: 3, engineId: "absent-engine",
    version: "1.0.0", domain: "math", method: "fixture-engine", run: double(3),
  });
  // math.present: L3 on the present engine only at the top.
  registerTier({
    solverId: "math.present", tier: 3, engineId: "present-engine",
    version: "1.0.0", domain: "math", method: "fixture-engine", run: double(3),
  });
  // math.engineonly: nothing but an absent-engine tier.
  registerTier({
    solverId: "math.engineonly", tier: 3, engineId: "absent-engine",
    version: "1.0.0", domain: "math", method: "fixture-engine", run: double(3),
  });
}

test("reference case: engine absent → top tier NOT_COMPUTED + labelled fast path beside it", async () => {
  setup();
  const r = await runSelected("math.fixture", { inputs: { x: 10 } }, "value", { tier: 3 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:absent-engine");
  assert.equal(r.outputs.y, 20); // the L1 fast path's output, labelled
  assert.equal(r.solver.fidelity, "L1");
  assert.equal(r.solver.screening, true);
  assert.ok(r.warnings.join(" ").includes("labelled screening fast path"));
});

test("engine present → the top tier serves at its own tier, no screening downgrade", async () => {
  setup();
  const r = await runSelected("math.present", { inputs: { x: 10 } }, "value", { tier: 3 });
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.y, 30);
  assert.equal(r.solver.fidelity, "L3");
  assert.notEqual(r.solver.screening, true);
});

test("engine-only solver with absent engine → NOT_COMPUTED and NO outputs", async () => {
  setup();
  const r = await runSelected("math.engineonly", { inputs: { x: 10 } }, "value", { tier: 3 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:absent-engine");
  assert.deepEqual(r.outputs, {});
});

test("at-or-below: asking L1 serves L1 even though L3 exists; asking below every tier refuses", async () => {
  setup();
  const low = await runSelected("math.fixture", { inputs: { x: 10 } }, "value", { tier: 1 });
  assert.equal(low.status, "PASS");
  assert.equal(low.outputs.y, 20);
  assert.equal(low.solver.fidelity, "L1");
  const none = await runSelected("math.fixture", { inputs: { x: 10 } }, "value", { tier: 0 });
  assert.equal(none.status, "NOT_COMPUTED");
  assert.equal(none.reason, "tier_unavailable:math.fixture:L0");
});

test("unknown solver → NOT_COMPUTED solver_unknown", async () => {
  setup();
  const r = await runSelected("math.nope", { inputs: {} }, "value", { tier: 2 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "solver_unknown:math.nope");
  assert.equal(selectTier("math.nope", 2).reason, "solver_unknown:math.nope");
});

test("input integrity rides through the router (supplied echo mismatch → NOT_COMPUTED)", async () => {
  setup();
  const tampered = async () => ({ inputs: { x: 999 }, outputs: { y: 1 }, margins: [] });
  registerTier({
    solverId: "math.fixture", tier: 1, version: "1.0.0", domain: "math",
    method: "tampered", run: tampered,
  });
  const r = await runSelected("math.fixture", { inputs: { x: 10 } }, "value",
    { tier: 1, supplied: { x: 10 } });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("input_substituted:x"));
});

test("listTieredSolvers carries the engineDependent flag and availability", () => {
  setup();
  const rows = listTieredSolvers();
  const fixture = rows.find((r) => r.id === "math.fixture");
  assert.equal(fixture.engineDependent, true);
  assert.equal(fixture.tiers.find((t) => t.tier === 3).available, false);
  assert.equal(fixture.tiers.find((t) => t.tier === 1).available, true);
  const present = rows.find((r) => r.id === "math.present");
  assert.equal(present.tiers[0].available, true);
});
