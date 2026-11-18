/**
 * SX-NUM-19 math.arbitrary-precision tests.
 *
 * Reference case (catalogue): pi to 50 digits — the expected
 * expansion is the universal published constant, asserted as
 * a digit string. Beside it: sqrt(2), e, ln 10, sin(1) at 40
 * digits, and the cancellation case 10^20 + 1 - 10^20 that
 * binary doubles answer 0 and this solver answers exactly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/arbitrary-precision.js";

const solver = getSolver("math.arbitrary-precision");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with the declared-precision contract", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.regime.includes("precision declared per call"));
});

test("reference case: pi to 50 significant digits", () => {
  const r = run({ expression: "pi", digits: 50 }, "eval");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.value, "3.1415926535897932384626433832795028841971693993751");
});

test("sqrt(2), e, ln 10, sin(1) at 40 digits", () => {
  const cases = [
    ["sqrt(2)", "1.414213562373095048801688724209698078570"],
    ["exp(1)", "2.718281828459045235360287471352662497757"],
    ["log(10)", "2.302585092994045684017991454684364207601"],
    ["sin(1)", "0.8414709848078965066525023216302989996226"],
  ];
  for (const [expr, expected] of cases) {
    const r = run({ expression: expr, digits: 40 }, "eval");
    assert.equal(r.status, "PASS", `${expr}: ${r.reason || ""}`);
    assert.ok(r.outputs.value.startsWith(expected.slice(0, 38)), `${expr}: ${r.outputs.value} vs ${expected}`);
  }
});

test("the cancellation case doubles fail is exact here: 10^20 + 1 - 10^20 = 1", () => {
  assert.equal(1e20 + 1 - 1e20, 0); // the double-precision answer, for the record
  const r = run({ expression: "10^20 + 1 - 10^20", digits: 30 }, "eval");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.value, "1.00000000000000000000000000000");
});

test("division rounds half-even at the declared precision; variables arrive as strings", () => {
  const third = run({ expression: "2/3", digits: 20 }, "eval");
  assert.equal(third.outputs.value, "0.66666666666666666667");
  const withVar = run({ expression: "x^2 + 1", digits: 30, vars: { x: "1.41421356237309504880168872421" } }, "eval");
  assert.equal(withVar.status, "PASS", withVar.reason || "");
  assert.ok(withVar.outputs.value.startsWith("3.0000000000000000"), withVar.outputs.value);
  const missing = run({ expression: "y + 1", digits: 30 }, "eval");
  assert.equal(missing.status, "NOT_COMPUTED");
  assert.ok(missing.reason.includes("missing_input:variable y"), missing.reason);
});
