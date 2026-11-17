/**
 * SX-XC-02 props.material tests.
 *
 * Reference values come from the cited public sources named in the
 * module (MIL-HDBK-5J anchors, ASTM A36 minima, EN 1993-1-2 factors),
 * never from the solver's own output: 6061-T6 yield at RT = 276 MPa
 * (Fty 40 ksi); A36 yield at 500 °C = 250 MPa x 0.78 = 195 MPa;
 * steel E at 600 °C = 200 GPa x 0.31 = 62 GPa.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/props-material.js";
import { runSelected } from "../../lib/conkay/select.js";

const solver = getSolver("props.material");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with declared regime, units, tolerance, screening flag", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.regime && solver.units && solver.tolerance);
  assert.equal(solver.screening, false);
});

test("reference case: 6061-T6 yield strength at RT = 276 MPa (MIL-HDBK-5J Fty 40 ksi)", () => {
  const r = run({ material: "al-6061-t6", temperature: 293.15 }, "yieldStrength");
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.yieldStrength.value, 276e6);
  assert.equal(r.outputs.yieldStrength.unit, "Pa");
  assert.ok(r.outputs.provenance.includes("MIL-HDBK-5J"));
  assert.equal(r.outputs.interpolated, false);
});

test("temperature curves: A36 yield at 500 C = 195 MPa, steel E at 600 C = 62 GPa (EN 1993-1-2 factors)", () => {
  const y = run({ material: "steel-a36", temperature: { value: 500, unit: "°C" } }, "yieldStrength");
  assert.equal(y.status, "PASS");
  assert.equal(y.outputs.yieldStrength.value, 195e6);
  const e = run({ material: "steel-a36", temperature: { value: 600, unit: "°C" } }, "E");
  assert.equal(e.outputs.E.value, 62e9);
});

test("interpolation is linear between sourced points and labelled", () => {
  // Steel E between 400 C (140 GPa) and 500 C (120 GPa): at 450 C = 130 GPa.
  const r = run({ material: "steel-a36", temperature: { value: 450, unit: "°C" } }, "E");
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.E.value, 130e9);
  assert.equal(r.outputs.interpolated, true);
  assert.deepEqual(r.outputs.sourcedBracketK, [673.15, 773.15]);
});

test("extrapolation refused: beyond the sourced range → NOT_COMPUTED naming the bound", () => {
  const r = run({ material: "al-6061-t6", temperature: 600 }, "yieldStrength");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.includes("out_of_envelope"));
  assert.ok(r.reason.includes("293.15"));
});

test("physical trend: steel E decreases monotonically with temperature", () => {
  let prev = Infinity;
  for (const c of [20, 200, 400, 500, 600, 700]) {
    const r = run({ material: "steel-a36", temperature: { value: c, unit: "°C" } }, "E");
    assert.equal(r.status, "PASS");
    assert.ok(r.outputs.E.value < prev, `E at ${c}C below the previous step`);
    prev = r.outputs.E.value;
  }
});

test("SC-03/SC-04 legs: missing material, missing property, default temperature, unit conversion, invalid input", () => {
  assert.ok(run({}, "E").reason.startsWith("missing_input:material"));
  const noProp = run({ material: "steel-a36", temperature: 293.15 }, "creepRate");
  assert.equal(noProp.status, "NOT_COMPUTED"); // unknown property target
  const dflt = run({ material: "al-6061-t6" }, "E");
  assert.equal(dflt.status, "PASS");
  assert.ok(dflt.assumptions.join(" ").includes("defaulted"));
  const f = run({ material: "al-6061-t6", temperature: { value: 68, unit: "°F" } }, "E");
  assert.equal(f.status, "PASS"); // 68 F = 293.15 K exactly
  assert.equal(f.outputs.E.value, 68.9e9);
  assert.ok(f.assumptions.join(" ").includes("converted exactly"));
  assert.ok(run({ material: "al-6061-t6", temperature: NaN }, "E").reason.startsWith("invalid_input:temperature"));
  assert.ok(run({ material: "al-6061-t6", temperature: -5 }, "E").reason.startsWith("invalid_input:temperature"));
  assert.ok(run({ material: "unobtanium", temperature: 300 }, "E").reason.startsWith("unknown_material:"));
});

test("L1 fast path via solver.select: RT value at any temperature, labelled screening", async () => {
  const r = await runSelected("props.material",
    { inputs: { material: "steel-a36", temperature: 900 } }, "yieldStrength", { tier: 1 });
  assert.equal(r.status, "WARN"); // the screening warning rides the envelope: WARN, never a silent PASS
  assert.equal(r.outputs.yieldStrength.value, 250e6); // RT anchor, NOT the 900 K value
  assert.equal(r.solver.fidelity, "L1");
  assert.equal(r.solver.screening, true);
  assert.ok(r.warnings.join(" ").includes("temperature dependence not applied"));
  // And the L2 tier at the same temperature gives the curve value instead:
  // at 900 K the bracket is [873.15 K → 117.5 MPa, 973.15 K → 57.5 MPa],
  // f = 0.2685 → 117.5 - 0.2685 x 60 = 101.39 MPa.
  const top = await runSelected("props.material",
    { inputs: { material: "steel-a36", temperature: 900 } }, "yieldStrength", { tier: 2 });
  assert.equal(top.solver.fidelity, "L2");
  assert.ok(Math.abs(top.outputs.yieldStrength.value - 101.39e6) < 1e3);
});
