/**
 * SX-NUM-04 math.eigen tests.
 *
 * Reference cases are analytic: the catalogue's 2x2 case
 * [[2,1],[1,2]] (lambda = 3, 1), the tridiagonal Toeplitz matrix
 * whose eigenvalues are the closed form 2 - 2cos(k pi / (n+1)),
 * and a diagonal matrix. The sparse generalized BCSSTK class rides
 * the engine tier and is pinned as a refusal here. References:
 * Golub & Van Loan, Matrix Computations 4e; Matrix Market.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/eigen.js";

const solver = getSolver("math.eigen");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

test("registered at L3 with declared regime, units, tolerance", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("eig: the 2x2 analytic case — lambda 3 and 1, orthonormal vectors, verified pairs", () => {
  const r = run({ A: [[2, 1], [1, 2]] }, "eig");
  assert.equal(r.status, "PASS");
  assert.ok(close(r.outputs.eigenvalues[0], 3, 1e-12));
  assert.ok(close(r.outputs.eigenvalues[1], 1, 1e-12));
  const s = 1 / Math.sqrt(2);
  assert.ok(close(Math.abs(r.outputs.eigenvectors[0][0]), s, 1e-12));
  assert.ok(close(Math.abs(r.outputs.eigenvectors[0][1]), s, 1e-12));
  assert.ok(r.outputs.maxPairResidual < 1e-12);
  assert.ok(r.outputs.orthonormalityDefect < 1e-12);
});

test("eig: the tridiagonal Toeplitz spectrum matches the closed form 2 - 2cos(k pi/4)", () => {
  const A = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]];
  const r = run({ A }, "eig");
  assert.equal(r.status, "PASS");
  const expected = [2 + Math.SQRT2, 2, 2 - Math.SQRT2]; // descending
  r.outputs.eigenvalues.forEach((lam, i) => assert.ok(close(lam, expected[i], 1e-10), `${lam} vs ${expected[i]}`));
  assert.ok(r.outputs.maxPairResidual < 1e-10);
});

test("eig: diagonal matrix returns its diagonal, sorted descending", () => {
  const r = run({ A: [[3, 0, 0], [0, 1, 0], [0, 0, 2]] }, "eig");
  assert.deepEqual(r.outputs.eigenvalues, [3, 2, 1]);
});

test("eig: the non-symmetric full spectrum is the engine tier, refused by name", () => {
  const r = run({ A: [[0, 1], [-1, 0]] }, "eig");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("requires_engine_tier:lapack-arpack"));
});

test("dominant: power iteration serves only a residual-proven pair", () => {
  const r = run({ A: [[2, 1], [1, 2]] }, "dominant");
  assert.equal(r.status, "PASS");
  assert.ok(close(r.outputs.eigenvalue, 3, 1e-9));
  assert.ok(r.outputs.residualInf < 1e-9);
  const tri = run({ A: [[3, 1], [0, 2]] }, "dominant");
  // asserted at the solver's declared pair tolerance (residual <= 1e-9 * ||A||inf)
  assert.ok(close(tri.outputs.eigenvalue, 3, 1e-8));
  assert.ok(close(Math.abs(tri.outputs.eigenvector[0]), 1, 1e-6));
});

test("dominant: a rotation (complex dominant pair) is NOT_COMPUTED, never approximated", () => {
  const r = run({ A: [[0, 1], [-1, 0]] }, "dominant");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("not_converged"), r.reason);
});

test("malformed input refused by name", () => {
  assert.ok(run({ A: [[1, 2], [3]] }, "eig").reason.startsWith("invalid_input:A"));
  assert.ok(run({ A: [[1, Number.POSITIVE_INFINITY], [0, 1]] }, "eig").reason.startsWith("invalid_input:A"));
});
