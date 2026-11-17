/**
 * SX-NUM-06 math.roots tests.
 *
 * Reference cases: the catalogue's x^2 - 2 (root sqrt(2), Brent
 * and Newton); the MINPACK Rosenbrock system (More, Garbow,
 * Hillstrom ANL-80-74) with its known root (1, 1); polynomial root
 * sets with known factorizations. Methods per Numerical Recipes
 * 3e Ch. 9. Every served answer must carry a small residual — the
 * tests assert the residuals, not just the roots.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/roots.js";

const solver = getSolver("math.roots");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with declared regime, units, tolerance", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("brent: x^2 - 2 on [1, 2] converges to sqrt(2) with a verified residual", () => {
  const r = run({ coefficients: [1, 0, -2], bracket: [1, 2] }, "brent");
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.root - Math.SQRT2) < 1e-13);
  assert.ok(r.outputs.residual < 1e-12);
});

test("brent: a bracket without a sign change is refused, never widened silently", () => {
  const r = run({ coefficients: [1, 0, -2], bracket: [2, 3] }, "brent");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("no_bracket_sign_change"));
  assert.ok(run({ coefficients: [1, 0, -2] }, "brent").reason.startsWith("missing_input:bracket"));
});

test("newton: x^2 - 2 from x0 = 1; a stationary start is refused by name", () => {
  const r = run({ coefficients: [1, 0, -2], x0: 1 }, "newton");
  assert.equal(r.status, "PASS");
  assert.ok(Math.abs(r.outputs.root - Math.SQRT2) < 1e-13);
  const flat = run({ coefficients: [1, 0, 1], x0: 0 }, "newton"); // p = x^2+1, p'(0) = 0
  assert.equal(flat.status, "NOT_COMPUTED");
  assert.ok(flat.reason.startsWith("derivative_vanished"));
});

test("roots: known factorizations recovered, real and complex, each residual-verified", () => {
  const cubic = run({ coefficients: [1, -6, 11, -6] }, "roots"); // (x-1)(x-2)(x-3)
  assert.equal(cubic.status, "PASS");
  assert.deepEqual(cubic.outputs.roots.map((z) => Math.round(z.re * 1e9) / 1e9), [1, 2, 3]);
  assert.ok(cubic.outputs.roots.every((z) => z.im === 0));
  const imag = run({ coefficients: [1, 0, 1] }, "roots"); // x^2 + 1 = 0 -> +/- i
  assert.equal(imag.outputs.roots.length, 2);
  assert.ok(imag.outputs.roots.every((z) => Math.abs(z.re) < 1e-9));
  assert.deepEqual(imag.outputs.roots.map((z) => Math.round(z.im)), [-1, 1]);
  const quartic = run({ coefficients: [1, -10, 35, -50, 24] }, "roots"); // (x-1)(x-2)(x-3)(x-4)
  assert.deepEqual(quartic.outputs.roots.map((z) => Math.round(z.re * 1e6) / 1e6), [1, 2, 3, 4]);
  const dbl = run({ coefficients: [1, -4, 4] }, "roots"); // (x-2)^2, double root
  assert.ok(dbl.outputs.roots.every((z) => Math.abs(z.re - 2) < 1e-4));
});

test("system: the MINPACK Rosenbrock problem converges to (1, 1) from the standard start", () => {
  // f1 = 10(x2 - x1^2), f2 = 1 - x1, as monomial term lists
  const equations = [
    [{ coeff: 10, powers: [0, 1] }, { coeff: -10, powers: [2, 0] }],
    [{ coeff: 1, powers: [0, 0] }, { coeff: -1, powers: [1, 0] }],
  ];
  const r = run({ equations, x0: [-1.2, 1] }, "system"); // MINPACK's standard start
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.x[0] - 1) < 1e-9 && Math.abs(r.outputs.x[1] - 1) < 1e-9);
  assert.ok(r.outputs.residualInf <= 1e-12);
  assert.ok(run({ equations }, "system").reason.startsWith("missing_input:x0"));
});

test("malformed input refused by name", () => {
  assert.ok(run({ coefficients: [0, 1, -2], bracket: [0, 3] }, "brent").reason.startsWith("invalid_input:coefficients"));
  assert.ok(run({ coefficients: [1, Number.NaN] }, "roots").reason.startsWith("invalid_input:coefficients"));
});
