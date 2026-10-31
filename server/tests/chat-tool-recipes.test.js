// Brief E §1: recipe registry, run deterministically. The footbridge numbers go through run_recipe.
import test from "node:test";
import assert from "node:assert/strict";
import { listRecipes, runRecipe } from "../lib/chat/tool-recipes/index.js";

const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol * Math.abs(b);

test("the registry lists the starter recipes and matches by intent words", () => {
  assert.deepEqual(listRecipes().map((r) => r.id).sort(), ["beam_sizing", "column_buckling", "material_compare", "pipe_flow", "pressure_vessel", "reaction_balance", "unit_conversion", "wall_conduction"]);
  assert.equal(listRecipes("size a beam for a footbridge")[0].id, "beam_sizing");
  assert.equal(listRecipes("euler buckling of a strut")[0].id, "column_buckling");
  assert.deepEqual(listRecipes("zzzz nothing"), []);
  assert.equal(listRecipes("beam")[0].inputs.spanM.unit, "m");
});

test("footbridge beam, A36: 125 mm, deflection governs, all checks pass", () => {
  const r = runRecipe("beam_sizing", { spanM: 4, loadN: 10000, widthM: "60 mm", material: "steel-a36", safetyFactor: 2, deflectionLimit: 360 });
  assert.equal(r.ok, true);
  assert.equal(r.result.depthM, 0.125);
  assert.equal(r.result.governs, "deflection");
  assert.equal(r.passed, true);
  assert.deepEqual(r.checks.slice(0, 3).map((c) => c.name), ["strength", "deflection", "hand_vs_FE"]);
  assert.ok(r.checks.some((c) => c.name.startsWith("independent:")));
  assert.equal(r.receipt.units, "SI");
  assert.equal(r.receipt.inputs.widthM, 0.06);
});

test("footbridge beam, 6061-T6: 160 mm", () => {
  const r = runRecipe("beam_sizing", { spanM: 4, loadN: 10000, widthM: 0.06, material: "aluminum-6061-t6", safetyFactor: 2 });
  assert.equal(r.result.depthM, 0.16);
});

test("footbridge column: Pcr 568.5 kN, FS 7.11, L/r 144.3", () => {
  const r = runRecipe("column_buckling", { lengthM: 2.5, modulusPa: "200 GPa", widthM: "60 mm", heightM: "100 mm", loadN: "80 kN" });
  assert.equal(r.ok, true);
  assert.ok(near(r.result.criticalLoadN / 1e3, 568.5, 0.001));
  assert.ok(near(r.result.factorOfSafety, 7.11, 0.001));
  assert.ok(near(r.result.slenderness, 144.3, 0.001));
  assert.equal(r.passed, true);
});

test("a failing design is reported failed, not passed", () => {
  const r = runRecipe("column_buckling", { lengthM: 2.5, modulusPa: 200e9, widthM: 0.06, heightM: 0.1, loadN: 500000 });
  assert.equal(r.passed, false);
  assert.match(r.note, /factor_of_safety/);
});

test("missing and invalid inputs are named, never filled in", () => {
  const m = runRecipe("beam_sizing", { spanM: 4 });
  assert.equal(m.ok, false);
  assert.match(m.error, /missing: loadN, widthM, material, safetyFactor/);
  assert.ok(m.inputSchema.loadN.required);
  const b = runRecipe("beam_sizing", { spanM: "4 furlong", loadN: 1, widthM: 1, material: "steel-a36", safetyFactor: 2 });
  assert.match(b.error, /invalid: spanM/);
  assert.equal(runRecipe("nope", {}).ok, false);
});

test("unknown material is an honest error", () => {
  assert.match(runRecipe("beam_sizing", { spanM: 4, loadN: 1000, widthM: 0.06, material: "unobtainium", safetyFactor: 2 }).error, /unknown material/);
});

test("unit conversion, material comparison, conduction, pipe flow", () => {
  assert.ok(near(runRecipe("unit_conversion", { value: 29000, from: "ksi", to: "GPa" }).result.value, 199.947, 0.001));
  assert.equal(runRecipe("unit_conversion", { value: 1, from: "kN", to: "mm" }).ok, false);
  const c = runRecipe("material_compare", { materials: ["steel-a36", "aluminum-6061-t6"] });
  assert.equal(c.result.highest.youngsModulusPa, "steel-a36");
  assert.equal(c.result.highest.specificStrength, "aluminum-6061-t6");
  const w = runRecipe("wall_conduction", { conductivityWmK: 0.8, areaM2: 10, thicknessM: "0.2 m", deltaTK: 20 });
  assert.ok(near(w.result.heatFlowW, 800, 1e-9));
  const p = runRecipe("pipe_flow", { densityKgM3: 998, viscosityPaS: 0.001, velocityMs: 0.01, diameterM: 0.05, lengthM: 10 });
  assert.equal(p.result.regime, "laminar");
  assert.ok(near(p.result.frictionFactor, 64 / p.result.reynolds, 1e-9));
  assert.equal(runRecipe("pipe_flow", { densityKgM3: 998, viscosityPaS: 0.001, velocityMs: 2, diameterM: 0.05, lengthM: 10 }).result.regime, "turbulent");
});

import { executeToolCall } from "../lib/chat-agent.js";
const call = (tool, params) => executeToolCall({}, () => null, new Map(), { tool, params });

test("the chat tools list and run recipes end to end (footbridge, no LLM)", async () => {
  const l = await call("list_recipes", { query: "buckling" });
  assert.equal(l.ok, true);
  assert.equal(l.recipes[0].id, "column_buckling");
  const beam = await call("run_recipe", { recipe: "beam_sizing", inputs: { spanM: 4, loadN: 10000, widthM: "60 mm", material: "steel-a36", safetyFactor: 2 } });
  assert.equal(beam.ok, true);
  assert.equal(beam.result.depthM, 0.125);
  const col = await call("run_recipe", { recipe: "column_buckling", inputs: { lengthM: 2.5, modulusPa: 200e9, widthM: 0.06, heightM: 0.1, loadN: 80000 } });
  assert.ok(near(col.result.criticalLoadN, 568.5e3, 0.001));
  const bad = await call("run_recipe", { recipe: "beam_sizing", inputs: {} });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /missing/);
});
