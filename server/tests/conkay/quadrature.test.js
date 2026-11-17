/**
 * SX-NUM-07 math.quadrature tests.
 *
 * Reference integrals are closed forms (NIST DLMF identities):
 * the catalogue's endpoint-singular case int_0^1 x^-1/2 dx = 2,
 * int_0^pi sin = 2, int_0^1 e^x = e - 1, int_0^1 sqrt(x) = 2/3,
 * and the Runge integrand int_-1^1 dx/(1+25x^2) = (2/5) atan(5).
 * The validity envelope is pinned both ways: an answer ships only
 * with errorEstimate <= tol, and a demand the method cannot meet
 * is NOT_COMPUTED, never a quiet number.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/quadrature.js";

const solver = getSolver("math.quadrature");
const run = (inputs, target = "integrate") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the error-estimate envelope declared", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("error estimate"));
});

test("the reference case: int_0^1 x^-1/2 dx = 2 through the endpoint singularity", () => {
  const r = run({ expression: "x^(-1/2)", a: 0, b: 1, tol: 1e-9 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.value - 2) < 1e-7, `got ${r.outputs.value}`);
  assert.ok(r.outputs.errorEstimate <= 1e-9 * 2);
});

test("closed forms: sin over [0, pi], e^x over [0, 1], sqrt over [0, 1]", () => {
  const s = run({ expression: "sin(x)", a: 0, b: Math.PI });
  assert.ok(Math.abs(s.outputs.value - 2) < 1e-10);
  const e = run({ expression: "exp(x)", a: 0, b: 1 });
  assert.ok(Math.abs(e.outputs.value - (Math.E - 1)) < 1e-10);
  const sq = run({ expression: "sqrt(x)", a: 0, b: 1, tol: 1e-9 });
  assert.ok(Math.abs(sq.outputs.value - 2 / 3) < 1e-8);
  const rev = run({ expression: "exp(x)", a: 1, b: 0 });
  assert.ok(Math.abs(rev.outputs.value + (Math.E - 1)) < 1e-10); // reversed limits negate
});

test("the Runge integrand: int_-1^1 dx/(1+25x^2) = (2/5) atan(5)", () => {
  const expected = (2 / 5) * Math.atan(5);
  const r = run({ expression: "1/(1 + 25*x^2)", a: -1, b: 1, tol: 1e-11 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.value - expected) < 1e-9, `${r.outputs.value} vs ${expected}`);
});

test("adaptive simpson agrees on smooth integrands and carries its own estimate", () => {
  const r = run({ expression: "sin(x)", a: 0, b: Math.PI, tol: 1e-10 }, "simpson");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.value - 2) < 1e-9);
  assert.ok(r.outputs.errorEstimate <= 1e-10);
});

test("the envelope refuses what the method cannot certify", () => {
  // adaptive simpson evaluates the endpoint: x^-1/2 at 0 is not finite
  const sing = run({ expression: "x^(-1/2)", a: 0, b: 1, tol: 1e-9 }, "simpson");
  assert.equal(sing.status, "NOT_COMPUTED");
  assert.ok(sing.reason.startsWith("integrand_not_finite"), sing.reason);
  // a tolerance the method cannot certify is a refusal with the
  // estimate named, not a number: sqrt's endpoint derivative
  // singularity exhausts the depth cap at tol 1e-12
  const tight = run({ expression: "sqrt(x)", a: 0, b: 1, tol: 1e-12 }, "simpson");
  assert.equal(tight.status, "NOT_COMPUTED");
  assert.ok(tight.reason.startsWith("error_estimate_above_tolerance"), tight.reason);
});

test("scope refusals are named: infinite interval, missing integrand, bad tolerance", () => {
  assert.ok(run({ expression: "exp(-x)", a: 0, b: Infinity }).reason.startsWith("missing_input:finite"));
  assert.ok(run({ a: 0, b: 1 }).reason.startsWith("missing_input:expression"));
  assert.ok(run({ expression: "x", a: 0, b: 1, tol: -1 }).reason.startsWith("invalid_input:tol"));
  assert.ok(run({ expression: "x +", a: 0, b: 1 }).reason.startsWith("invalid_input:expression"));
});
