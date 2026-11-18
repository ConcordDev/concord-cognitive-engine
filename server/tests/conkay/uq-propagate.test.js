/**
 * SX-XC-06 uq.propagate tests.
 *
 * Reference case (catalogue; NIST/SEMATECH e-Handbook):
 * the linear model y = 2x1 + 3x2 + 1 with x1 ~ N(10, 2^2)
 * and x2 ~ U(0, 6) has analytic mean 30 and variance
 * 4*4 + 9*3 = 43; Sobol indices {16/43, 27/43}. Sampled
 * estimates are seeded and pinned against the analytic
 * values, never against themselves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/uq-propagate.js";

const solver = getSolver("uq.propagate");
const run = (inputs, target = "propagate") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const LINEAR = {
  model: "linear",
  coefficients: [2, 3],
  intercept: 1,
  variables: [
    { name: "x1", dist: "normal", mean: 10, std: 2 },
    { name: "x2", dist: "uniform", min: 0, max: 6 },
  ],
};

test("registered at L3 with the NIST linear reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.reference.includes("NIST/SEMATECH"));
});

test("reference case: moments method returns the analytic mean 30 and variance 43 exactly", () => {
  const r = run({ ...LINEAR, method: "moments" });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.mean, 30, 1e-12), `mean ${r.outputs.mean}`);
  assert.ok(near(r.outputs.variance, 43, 1e-12), `variance ${r.outputs.variance}`);
  assert.ok(near(r.outputs.sobolFirstOrder[0], 16 / 43, 1e-12), `S1 ${r.outputs.sobolFirstOrder[0]}`);
  assert.ok(near(r.outputs.sobolFirstOrder[1], 27 / 43, 1e-12), `S2 ${r.outputs.sobolFirstOrder[1]}`);
});

test("seeded Monte Carlo converges to the analytic values within its own standard error", () => {
  const r = run({ ...LINEAR, method: "monte-carlo", samples: 20000, seed: 12345 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.mean - 30) <= 5 * r.outputs.standardErrorOfMean,
    `mean ${r.outputs.mean} vs 30 (SE ${r.outputs.standardErrorOfMean})`);
  assert.ok(Math.abs(r.outputs.variance - 43) <= 3, `variance ${r.outputs.variance} vs 43`);
  assert.equal(r.outputs.analyticMean, 30);
  assert.equal(r.outputs.analyticVariance, 43);
  // reproducibility: same seed, same numbers bit-for-bit
  const r2 = run({ ...LINEAR, method: "monte-carlo", samples: 20000, seed: 12345 });
  assert.equal(r2.outputs.mean, r.outputs.mean);
  assert.equal(r2.outputs.variance, r.outputs.variance);
});

test("Latin hypercube also converges, and its CI brackets the analytic mean", () => {
  const r = run({ ...LINEAR, method: "lhs", samples: 5000, seed: 777 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.mean - 30) <= 0.25, `LHS mean ${r.outputs.mean}`);
  assert.ok(r.outputs.ci95[0] < 30 && r.outputs.ci95[1] > 30, `CI ${r.outputs.ci95}`);
});

test("product model: analytic mean 40, variance 168, Sobol {64/168, 100/168} with interaction remainder", () => {
  const r = run({
    model: "product", method: "moments",
    variables: [
      { name: "x1", dist: "normal", mean: 5, std: 1 },
      { name: "x2", dist: "normal", mean: 8, std: 2 },
    ],
  });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.mean, 40, 1e-9), `mean ${r.outputs.mean}`);
  assert.ok(near(r.outputs.variance, 168, 1e-9), `variance ${r.outputs.variance}`);
  assert.ok(near(r.outputs.sobolFirstOrder[0], 64 / 168, 1e-9));
  assert.ok(near(r.outputs.sobolFirstOrder[1], 100 / 168, 1e-9));
  assert.ok(r.outputs.sobolFirstOrder[0] + r.outputs.sobolFirstOrder[1] < 1, "interaction remainder must remain");
});

test("lognormal moments match the textbook formulas", () => {
  const mu = 0;
  const sigma = 0.5;
  const r = run({
    model: "linear", coefficients: [1], intercept: 0, method: "moments",
    variables: [{ name: "x", dist: "lognormal", mu, sigma }],
  });
  assert.equal(r.status, "PASS", r.reason || "");
  const mean = Math.exp(mu + (sigma * sigma) / 2);
  const variance = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma);
  assert.ok(near(r.outputs.mean, mean, 1e-12), `mean ${r.outputs.mean} vs ${mean}`);
  assert.ok(near(r.outputs.variance, variance, 1e-12), `variance ${r.outputs.variance} vs ${variance}`);
});

test("refusals: unknown model/dist/method, bad params, engine tier", () => {
  const noModel = run({ variables: LINEAR.variables });
  assert.equal(noModel.status, "NOT_COMPUTED");
  assert.ok(noModel.reason.includes("missing_input:model"), noModel.reason);
  const badDist = run({ model: "linear", coefficients: [1], variables: [{ name: "x", dist: "weibull" }] });
  assert.equal(badDist.status, "NOT_COMPUTED");
  assert.ok(badDist.reason.includes("invalid_input:variables[0]"), badDist.reason);
  const badStd = run({ model: "linear", coefficients: [1], variables: [{ name: "x", dist: "normal", mean: 0, std: -1 }] });
  assert.equal(badStd.status, "NOT_COMPUTED");
  assert.ok(badStd.reason.includes("std > 0"), badStd.reason);
  const badMethod = run({ ...LINEAR, method: "pce" });
  assert.equal(badMethod.status, "NOT_COMPUTED");
  assert.ok(badMethod.reason.includes("requires_engine_tier:sxe-22"), badMethod.reason);
  const eng = run(LINEAR, "engine");
  assert.equal(eng.status, "NOT_COMPUTED");
  assert.ok(eng.reason.includes("requires_engine_tier:sxe-22"), eng.reason);
});
