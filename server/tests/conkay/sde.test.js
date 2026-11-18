/**
 * SX-NUM-17 math.sde tests.
 *
 * Reference (Kloeden & Platen): the GBM exact law — mean
 * S0 e^{mu t} (the catalogue's reference case), variance
 * S0^2 e^{2 mu t} (e^{sigma^2 t} - 1). All statistical pins
 * are deterministic under the declared seed and asserted
 * against standard-error-scaled tolerances computed from the
 * exact law, not from the sample. The strong order is
 * MEASURED by common random numbers against the exact GBM
 * solution.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/sde.js";

const solver = getSolver("math.sde");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const GBM = { drift: "0.1*x", diffusion: "0.3*x", x0: 100, t1: 1 };

test("registered at L3 with declared orders in its method", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.method.includes("strong 1/2"));
});

test("reference case: the GBM mean matches S0 e^{mu t} within standard errors (seeded)", () => {
  const r = run({ ...GBM, steps: 100, paths: 20000, seed: 777 }, "simulate");
  assert.equal(r.status, "PASS", r.reason || "");
  const exactMean = 100 * Math.exp(0.1);
  const exactVar = 10000 * Math.exp(0.2) * (Math.exp(0.09) - 1);
  const exactSe = Math.sqrt(exactVar / 20000);
  assert.ok(Math.abs(r.outputs.mean - exactMean) < 4 * exactSe, `mean ${r.outputs.mean} vs ${exactMean} (se ${exactSe})`);
  assert.ok(Math.abs(r.outputs.variance - exactVar) / exactVar < 0.12, `var ${r.outputs.variance} vs ${exactVar}`);
  assert.equal(r.inputs.seed, 777);
});

test("the same seed reproduces the ensemble bitwise; a different seed does not", () => {
  const a = run({ ...GBM, steps: 50, paths: 2000, seed: 42 }, "simulate");
  const b = run({ ...GBM, steps: 50, paths: 2000, seed: 42 }, "simulate");
  const c = run({ ...GBM, steps: 50, paths: 2000, seed: 43 }, "simulate");
  assert.equal(a.outputs.mean, b.outputs.mean);
  assert.notEqual(a.outputs.mean, c.outputs.mean);
});

test("zero diffusion degenerates to the ODE: EM tracks e^{mu t} to discretization error", () => {
  const r = run({ drift: "0.1*x", diffusion: "0", x0: 100, t1: 1, steps: 2000, paths: 100, seed: 1 }, "simulate");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.mean - 100 * Math.exp(0.1)) < 0.01, `mean ${r.outputs.mean}`);
  assert.ok(r.outputs.variance < 1e-20, `variance ${r.outputs.variance} (float dust only — every path is the same ODE trajectory)`);
});

test("strong order is measured, not asserted: EM on GBM lands near 1/2 by common random numbers", () => {
  const r = run({ mu: 0.1, sigma: 0.3, x0: 100, t1: 1, steps: 32, paths: 2000, seed: 99 }, "strong-order");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.measuredOrder > 0.3 && r.outputs.measuredOrder < 0.75, `measured order ${r.outputs.measuredOrder}`);
});

test("milstein serves GBM with its declared order and a comparable mean", () => {
  const r = run({ ...GBM, steps: 100, paths: 20000, seed: 777, method: "milstein" }, "simulate");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.deepEqual(r.outputs.declaredOrder, { strong: 1, weak: 1 });
  const exactSe = Math.sqrt((10000 * Math.exp(0.2) * (Math.exp(0.09) - 1)) / 20000);
  assert.ok(Math.abs(r.outputs.mean - 100 * Math.exp(0.1)) < 4 * exactSe, `milstein mean ${r.outputs.mean}`);
});

test("OU mean reversion: the ensemble mean tracks theta (1 - e^{-kappa t}) + x0 e^{-kappa t}", () => {
  const r = run({ drift: "2*(5 - x)", diffusion: "0.5", x0: 0, t1: 1, steps: 100, paths: 20000, seed: 5 }, "simulate");
  assert.equal(r.status, "PASS", r.reason || "");
  const exactMean = 5 * (1 - Math.exp(-2));
  // exact OU variance: sigma^2/(2 kappa) (1 - e^{-2 kappa t})
  const exactVar = (0.25 / 4) * (1 - Math.exp(-4));
  const exactSe = Math.sqrt(exactVar / 20000);
  assert.ok(Math.abs(r.outputs.mean - exactMean) < 5 * exactSe + 0.01, `OU mean ${r.outputs.mean} vs ${exactMean}`);
});
