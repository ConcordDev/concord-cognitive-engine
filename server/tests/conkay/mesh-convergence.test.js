/**
 * SX-XC-04 verify.mesh-convergence tests.
 *
 * Reference case: a manufactured sequence with a known exact answer —
 * f(h) = 2 + 0.5 h^2 sampled at h = 0.1/0.2/0.4 (r = 2) gives
 * f = 2.005 / 2.02 / 2.08. Expected values computed by hand from the
 * Celik et al. procedure (not from the solver): observed order
 * p = ln(e32/e21)/ln 2 = 1.9893, extrapolated value 1.99995 (exact
 * answer 2.0), GCI_fine = 1.25 x e21/(r^p - 1) = 0.003149, and the
 * asymptotic ratio is exactly 1 by construction.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/mesh-convergence.js";
import { gciStudy } from "../../lib/conkay/physics/solvers/mesh-convergence.js";

const solver = getSolver("verify.mesh-convergence");
const run = (inputs) => envelope(solver, "gci", solver.run({ inputs }, "gci"), { runtimeMs: 1 });

const MANUFACTURED = { solutions: [2.005, 2.02, 2.08], refinementRatio: 2 };

test("registered at L3 with declared regime, units, tolerance, screening flag", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime && solver.units && solver.tolerance);
  assert.equal(solver.screening, false);
});

test("reference case: manufactured sequence recovers p ~ 1.989, f_ext ~ 2.0, GCI_fine ~ 0.003149", () => {
  const r = run(MANUFACTURED);
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.observedOrder - 1.9893) < 0.005, `p = ${r.outputs.observedOrder}`);
  assert.ok(Math.abs(r.outputs.extrapolatedValue - 2.0) < 1e-3, `f_ext = ${r.outputs.extrapolatedValue}`);
  assert.ok(Math.abs(r.outputs.gciFine - 0.003149) < 2e-5, `GCI = ${r.outputs.gciFine}`);
  assert.ok(Math.abs(r.outputs.asymptoticRatio - 1) < 1e-9);
  assert.equal(r.outputs.convergenceType, "monotonic");
  assert.ok(r.outputs.gciCoarse > r.outputs.gciFine);
});

test("tolerance turns GCI_fine into a margin: inside → PASS, outside → FAIL", () => {
  assert.equal(run({ ...MANUFACTURED, tolerance: 0.01 }).status, "PASS");
  const fail = run({ ...MANUFACTURED, tolerance: 0.001 });
  assert.equal(fail.status, "FAIL");
  assert.equal(fail.margins[0].name, "gci_fine_within_tolerance");
});

test("oscillatory convergence → NOT_COMPUTED with the spread beside the refusal", () => {
  const r = run({ solutions: [1.0, 1.1, 1.05], refinementRatio: 2 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "oscillatory_convergence");
  assert.ok(Math.abs(r.outputs.spread - 0.1) < 1e-12);
  assert.equal(r.outputs.gciFine, undefined); // no GCI is served for an oscillatory sequence
});

test("divergent convergence → NOT_COMPUTED with the negative order beside it", () => {
  const r = run({ solutions: [1.0, 1.03, 1.04], refinementRatio: 2 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "divergent_convergence");
  assert.ok(r.outputs.observedOrder < 0);
});

test("envelope refusals name themselves: meshes, ratio, non-uniform, zero scale, non-finite", () => {
  assert.ok(run({ solutions: [1, 2], refinementRatio: 2 }).reason.startsWith("insufficient_meshes"));
  assert.ok(run({ solutions: [1, 2, 3], refinementRatio: 1 }).reason.startsWith("invalid_input:refinementRatio"));
  assert.ok(run({ solutions: [1, 2, 3], refinementRatio: 2, r21: 2, r32: 3 }).reason.startsWith("nonuniform_refinement"));
  assert.ok(run({ solutions: [0, 1, 2], refinementRatio: 2 }).reason.startsWith("invalid_input:solutions[0]"));
  assert.ok(run({ solutions: [1, NaN, 2], refinementRatio: 2 }).reason.startsWith("invalid_input:solutions[1]"));
  assert.ok(run({ refinementRatio: 2 }).reason.startsWith("missing_input:solutions"));
});

test("identical fine pair is a result: GCI_fine = 0, order undefined, PASS", () => {
  const r = run({ solutions: [2.0, 2.0, 2.5], refinementRatio: 2 });
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.gciFine, 0);
  assert.equal(r.outputs.observedOrder, null);
  assert.equal(gciStudy({ f1: 2, f2: 2, f3: 2.5, r: 2 }).extrapolatedValue, 2);
});
