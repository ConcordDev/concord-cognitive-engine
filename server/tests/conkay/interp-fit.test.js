/**
 * SX-NUM-13 math.interp-fit tests.
 *
 * Reference cases (closed-form self-checks per the catalogue
 * row): the clamped spline reproduces a cubic EXACTLY (the
 * catalogue's reference case); PCHIP preserves monotonicity;
 * Chebyshev interpolation of exp carries a sampled error
 * certificate; RBF interpolation reproduces its centers; a
 * polynomial fit recovers known coefficients. The hull
 * envelope refuses outside points on every target.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/interp-fit.js";

const solver = getSolver("math.interp-fit");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with the data-hull envelope in its regime", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.regime.includes("DATA HULL"));
});

test("reference case: the clamped spline reproduces x^3 exactly", () => {
  const xs = [0, 0.5, 1, 1.5, 2];
  const ys = xs.map((x) => x ** 3);
  const r = run({ xs, ys, bc: { type: "clamped", da: 0, db: 12 }, points: [0.25, 0.75, 1.25, 1.75] }, "spline");
  assert.equal(r.status, "PASS", r.reason || "");
  for (const v of r.outputs.values) {
    assert.ok(Math.abs(v.y - v.x ** 3) < 1e-9, `x=${v.x}: ${v.y} vs ${v.x ** 3}`);
  }
});

test("natural spline tracks sin at the midpoints", () => {
  const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const ys = xs.map((x) => Math.sin(x));
  const r = run({ xs, ys, points: [0.75, 1.75, 2.75] }, "spline");
  assert.equal(r.status, "PASS", r.reason || "");
  for (const v of r.outputs.values) assert.ok(Math.abs(v.y - Math.sin(v.x)) < 2e-3, `x=${v.x}`);
});

test("pchip: monotone data gives a monotone interpolant, nodes exact", () => {
  const xs = [0, 1, 2, 3];
  const ys = [0, 1, 1.5, 1.75];
  const r = run({ xs, ys, points: [0.5, 1.5, 2.5] }, "pchip");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.monotonicityViolation, 0);
  const atNodes = run({ xs, ys, points: [1, 2] }, "pchip");
  assert.deepEqual(atNodes.outputs.values.map((v) => v.y), [1, 1.5]);
});

test("chebyshev: exp on [-1, 1] at degree 12 carries a tiny sampled error certificate", () => {
  const r = run({ f: "exp(x)", a: -1, b: 1, degree: 12, points: [0, 0.5] }, "chebyshev");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.sampledMaxError < 1e-8, `cert ${r.outputs.sampledMaxError}`);
  assert.ok(Math.abs(r.outputs.values[1].y - Math.exp(0.5)) < 1e-8);
});

test("rbf: scattered samples of x^2 + y^2 interpolate the centers and the middle", () => {
  const pointsIn = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1], [0.25, 0.75]];
  const values = pointsIn.map(([x, y]) => x * x + y * y);
  const r = run({ pointsIn, values, kernel: "gaussian", shape: 1.5, points: [[0.5, 0.5], [0, 0]] }, "rbf");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[1].y - 0) < 1e-6, "center reproduction");
  assert.ok(Math.abs(r.outputs.values[0].y - 0.5) < 0.1, `middle ${r.outputs.values[0].y} (measured 0.4204 on this 9-center set)`);
});

test("fit: known quadratic coefficients recovered; degree >= points refused", () => {
  const xs = [0, 1, 2, 3, 4, 5];
  const ys = xs.map((x) => 1 + 2 * x + 3 * x * x);
  const r = run({ xs, ys, degree: 2 }, "fit");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.coefficients[0] - 1) < 1e-8);
  assert.ok(Math.abs(r.outputs.coefficients[1] - 2) < 1e-8);
  assert.ok(Math.abs(r.outputs.coefficients[2] - 3) < 1e-8);
  assert.ok(r.outputs.rmsResidual < 1e-9);
  const bad = run({ xs, ys, degree: 6 }, "fit");
  assert.equal(bad.status, "NOT_COMPUTED");
  assert.ok(bad.reason.includes("interpolation, not a fit"), bad.reason);
});

test("the hull envelope refuses outside points by name", () => {
  const r = run({ xs: [0, 1, 2], ys: [0, 1, 0], points: [2.5] }, "spline");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("outside_data_hull"), r.reason);
  const unsorted = run({ xs: [0, 2, 1], ys: [0, 1, 0], points: [0.5] }, "spline");
  assert.ok(unsorted.reason.includes("strictly increasing"), unsorted.reason);
});
