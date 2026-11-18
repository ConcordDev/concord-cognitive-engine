/**
 * SX-NUM-09 math.bvp tests.
 *
 * References (Ascher, Mattheij & Russell): the catalogue's
 * Blasius problem with f''(0) = 0.33205733621519630; the linear
 * oscillator BVP whose solution is sin x; the nonlinear problem
 * y'' = 2 y^3 with the exact solution y = 1/(1 + x); and the
 * resonant problem y'' = -y, y(0) = 0, y(pi) = 1, which has NO
 * solution and must be refused, not fitted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/bvp.js";

const solver = getSolver("math.bvp");
const run = (inputs, target = "solve") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the mesh-doubling discipline declared", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("mesh-doubling"));
});

test("linear BVP: y'' = -y, y(0) = 0, y(pi/2) = 1 reproduces sin x", () => {
  const r = run({
    f: ["y1", "-y0"],
    bcLeft: ["y0"],
    bcRight: ["y0 - 1"],
    a: 0,
    b: Math.PI / 2,
    mesh: 64,
    tol: 1e-4,
  });
  assert.equal(r.status, "PASS", r.reason || "");
  const mid = r.outputs.nodes[Math.floor(r.outputs.nodes.length / 2)];
  assert.ok(Math.abs(mid.y[0] - Math.sin(mid.x)) < 2e-3, `mid ${mid.y[0]} vs sin ${Math.sin(mid.x)}`);
  assert.ok(Math.abs(r.outputs.nodes.at(-1).y[0] - 1) < 1e-9);
  assert.ok(r.outputs.meshErrorEstimate <= 1e-4);
});

test("nonlinear BVP: y'' = 2y^3, y(0) = 1, y(1) = 1/2 reproduces 1/(1+x)", () => {
  const r = run({
    f: ["y1", "2*y0^3"],
    bcLeft: ["y0 - 1"],
    bcRight: ["y0 - 0.5"],
    a: 0,
    b: 1,
    mesh: 64,
    tol: 1e-4,
  });
  assert.equal(r.status, "PASS", r.reason || "");
  const at = (x) => r.outputs.nodes.reduce((p, nd) => (Math.abs(nd.x - x) < Math.abs(p.x - x) ? nd : p));
  assert.ok(Math.abs(at(0.5).y[0] - 2 / 3) < 3e-3, `y(0.5) = ${at(0.5).y[0]}`);
});

test("Blasius: f''(0) matches the textbook constant", () => {
  const r = run({}, "blasius");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.fpp0 - 0.3320573362151963) < 2e-4, `f''(0) = ${r.outputs.fpp0}`);
  assert.ok(Math.abs(r.outputs.fpEnd - 1) <= 1e-9);
});

test("the resonant problem has no solution and is refused, not fitted", () => {
  const r = run({
    f: ["y1", "-y0"],
    bcLeft: ["y0"],
    bcRight: ["y0 - 1"],
    a: 0,
    b: Math.PI,
    mesh: 16,
    tol: 1e-6,
  });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(/singular_collocation|not_converged/.test(r.reason), r.reason);
});

test("a wrong boundary-residual count is refused by name", () => {
  const r = run({ f: ["y1", "-y0"], bcLeft: ["y0"], bcRight: [], a: 0, b: 1 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("invalid_input:boundary conditions"), r.reason);
});
