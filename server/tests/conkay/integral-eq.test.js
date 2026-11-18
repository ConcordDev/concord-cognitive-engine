/**
 * SX-NUM-12 math.integral-eq tests.
 *
 * References (Atkinson): the Fredholm equation with K = x t,
 * f = 1, lambda = 1 has the exact solution u = 1 + 3x/4, and
 * lambda = 3 sits exactly on the kernel's eigenvalue (the
 * rank-one operator has eigenvalue 1/3), so it must refuse as
 * a resonance. Volterra with K = 1, f = 1 gives u = e^x; with
 * K = t it gives u = e^{x^2/2}. The BEM reference case is the
 * sphere capacitance C = 4 pi eps0 R.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/integral-eq.js";

const solver = getSolver("math.integral-eq");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the resonance refusal in its regime", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("eigenvalue"));
});

test("Fredholm: K = x t, f = 1, lambda = 1 reproduces u = 1 + 3x/4", () => {
  const r = run({ kernel: "x*t", f: "1", lambda: 1, a: 0, b: 1 }, "fredholm");
  assert.equal(r.status, "PASS", r.reason || "");
  for (const nd of r.outputs.nodes) {
    assert.ok(Math.abs(nd.u - (1 + 0.75 * nd.x)) < 1e-8, `node ${nd.x}: ${nd.u}`);
  }
  assert.ok(r.outputs.substitutionResidual < 1e-4);
});

test("Fredholm resonance: lambda = 3 is the kernel eigenvalue and is refused", () => {
  const r = run({ kernel: "x*t", f: "1", lambda: 3, a: 0, b: 1 }, "fredholm");
  assert.equal(r.status, "NOT_COMPUTED");
  // two honest catch layers: the discrete system is exactly
  // singular (singular_system), or — the quadrature's discrete
  // eigenvalue not being exactly 1/3 — the substitution
  // verification catches the garbage solution (residual 2)
  assert.ok(/singular_system|verification_failed/.test(r.reason), r.reason);
});

test("Volterra: K = 1, f = 1 reproduces e^x; K = t reproduces e^{x^2/2}", () => {
  const r1 = run({ kernel: "1", f: "1", a: 0, b: 1, mesh: 400 }, "volterra");
  assert.equal(r1.status, "PASS", r1.reason || "");
  assert.ok(Math.abs(r1.outputs.endValue - Math.E) < 2e-5, `e^x end ${r1.outputs.endValue}`);
  const r2 = run({ kernel: "t", f: "1", a: 0, b: 1, mesh: 400 }, "volterra");
  assert.equal(r2.status, "PASS", r2.reason || "");
  assert.ok(Math.abs(r2.outputs.endValue - Math.exp(0.5)) < 2e-5, `e^{x^2/2} end ${r2.outputs.endValue}`);
});

test("sphere capacitance: C / (4 pi eps0 R) is 1 within discretization error, density near-constant", () => {
  const r = run({ radius: 2, nTheta: 18, nPhi: 24 }, "sphere-capacitance");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.capacitanceRatio - 1) < 0.03, `ratio ${r.outputs.capacitanceRatio}`);
  // the density spread on a lat-lon grid is dominated by the
  // polar patch clustering (measured 0.27); it is reported
  // as-is, and an equal-area grid is the named refinement —
  // the catalogue reference quantity is the capacitance
  assert.ok(r.outputs.densitySpread < 0.35, `spread ${r.outputs.densitySpread}`);
});

test("missing kernel refuses by name (SC-03)", () => {
  const r = run({ f: "1", a: 0, b: 1 }, "fredholm");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("missing_input:kernel"), r.reason);
});
