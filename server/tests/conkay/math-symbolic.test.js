/**
 * SX-NUM-01 math.symbolic tests.
 *
 * Reference cases are textbook closed forms (NIST DLMF; OpenStax
 * Calculus): d/dx x^3 = 3x^2, ∫ sin x dx = −cos x (the catalogue
 * row's own reference case), ∫ x^2 dx = x^3/3, ∫ e^{2x} dx =
 * e^{2x}/2, ∫ dx/x = log x, ∫ log x dx = x log x − x. The behavioral
 * leg cross-checks symbolic derivatives against central finite
 * differences — an independent method.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import {
  parse, print, differentiate, evaluateAst,
} from "../../lib/conkay/physics/solvers/math-symbolic.js";
import "../../lib/conkay/physics/solvers/math-symbolic.js";

const solver = getSolver("math.symbolic");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L0 with declared regime, units, tolerance", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 0);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("differentiation: power, product, chain, and the elementary functions", () => {
  assert.equal(run({ expression: "x^3" }, "differentiate").outputs.result, "3*x^2");
  assert.equal(run({ expression: "sin(x)" }, "differentiate").outputs.result, "cos(x)");
  assert.equal(run({ expression: "cos(x)" }, "differentiate").outputs.result, "-sin(x)");
  assert.equal(run({ expression: "exp(2*x)" }, "differentiate").outputs.result, "2*exp(2*x)");
  assert.equal(run({ expression: "x*sin(x)" }, "differentiate").outputs.result, "cos(x)*x + sin(x)");
  assert.equal(run({ expression: "log(x)" }, "differentiate").outputs.result, "x^-1");
  assert.equal(run({ expression: "x^2 + 3*x" }, "differentiate").outputs.result, "2*x + 3");
  assert.equal(run({ expression: "5" }, "differentiate").outputs.result, "0");
});

test("integration reference cases (each served only after re-differentiation)", () => {
  const cases = [
    ["sin(x)", "-cos(x)"], // the catalogue row's reference case
    ["cos(x)", "sin(x)"],
    ["x^2", "1/3*x^3"],
    ["exp(2*x)", "1/2*exp(2*x)"],
    ["1/x", "log(x)"],
    ["log(x)", "log(x)*x - x"],
    ["x^2 + 3*x + 2", "1/3*x^3 + 3/2*x^2 + 2*x"],
    ["3", "3*x"],
  ];
  for (const [expr, expected] of cases) {
    const r = run({ expression: expr }, "integrate");
    assert.equal(r.status, "PASS", `${expr}: ${r.reason || ""}`);
    assert.equal(r.outputs.result, expected, expr);
    assert.equal(r.outputs.verifiedByRedifferentiation, true);
  }
});

test("simplify is canonical and exact: like terms collect, rationals stay rational", () => {
  assert.equal(run({ expression: "x + x" }, "simplify").outputs.result, "2*x");
  assert.equal(run({ expression: "x^2 + 2*x^2" }, "simplify").outputs.result, "3*x^2");
  assert.equal(run({ expression: "0.1 + 0.2" }, "simplify").outputs.result, "3/10"); // exact, not 0.30000000000000004
  assert.equal(run({ expression: "2/4" }, "simplify").outputs.result, "1/2");
  assert.equal(run({ expression: "x*1 + 0" }, "simplify").outputs.result, "x");
});

test("evaluate: numeric at a point, constants included; undefined points refused", () => {
  assert.equal(run({ expression: "x^2 + 1", point: 3 }, "evaluate").outputs.result, 10);
  assert.ok(Math.abs(run({ expression: "sin(pi/2)", point: 0 }, "evaluate").outputs.result - 1) < 1e-12);
  assert.ok(run({ expression: "1/x", point: 0 }, "evaluate").reason.startsWith("evaluation_undefined"));
  assert.ok(run({ expression: "x^2" }, "evaluate").reason.startsWith("missing_input:point"));
});

test("behavioral cross-check: symbolic derivative vs central finite difference", () => {
  for (const expr of ["x^3 - 2*x", "sin(x)*exp(x)", "log(x) + x^2"]) {
    const ast = parse(expr);
    const d = differentiate(ast, "x");
    for (const x0 of [0.7, 1.3]) {
      const h = 1e-6;
      const fd = (evaluateAst(ast, { x: x0 + h }) - evaluateAst(ast, { x: x0 - h })) / (2 * h);
      const exact = evaluateAst(d, { x: x0 });
      assert.ok(Math.abs(fd - exact) < 1e-5, `${expr} at ${x0}: fd ${fd} vs symbolic ${exact}`);
    }
  }
});

test("the SymPy class is refused by name, never approximated", () => {
  for (const op of ["solve", "limit", "series", "dsolve", "laplace", "fourier"]) {
    const r = run({ expression: "x^2 - 1" }, op);
    assert.equal(r.status, "NOT_COMPUTED");
    assert.ok(r.reason.startsWith("requires_engine_tier:sympy"), op);
  }
});

test("outside the integrable class → NOT_COMPUTED naming the scope; parse errors name the position", () => {
  const r = run({ expression: "x*sin(x)" }, "integrate");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("not_integrable_in_js_scope"));
  assert.ok(run({ expression: "x +" }, "simplify").reason.startsWith("invalid_input:expression"));
  assert.ok(run({}, "simplify").reason.startsWith("missing_input:expression"));
  assert.equal(print(parse("2x + 1")), "2*x + 1"); // implicit multiplication
});
