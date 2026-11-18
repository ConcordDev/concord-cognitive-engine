/**
 * SX-NUM-11 math.pde-fdm-fvm tests.
 *
 * Reference (LeVeque): the Sod shock tube against the exact
 * Riemann solution — star pressure 0.30313, star velocity
 * 0.92745, star densities 0.42632 (left) / 0.26557 (right) at
 * t = 0.2, with the contact at x = 0.6855 and the shock at
 * x = 0.8504, so x = 0.55 samples the left star plateau,
 * x = 0.75 the right star plateau, x = 0.9 the undisturbed
 * right state. Plus the CFL honesty gate, the advection
 * translation check, and the Crank-Nicolson mode decay
 * exp(-alpha pi^2 t).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/pde-fdm-fvm.js";

const solver = getSolver("math.pde-fdm-fvm");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the CFL discipline in its regime", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("CFL"));
});

test("Sod shock tube: the plateaus match the exact Riemann solution", () => {
  const r = run({ mesh: 100, t: 0.2, tol: 5e-3 }, "sod");
  assert.equal(r.status, "PASS", r.reason || "");
  const s = r.outputs.samples;
  assert.ok(Math.abs(s["x0.55"].rho - 0.42632) < 0.03, `rho*(L) ${s["x0.55"].rho}`);
  assert.ok(Math.abs(s["x0.75"].rho - 0.26557) < 0.03, `rho*(R) ${s["x0.75"].rho}`);
  assert.ok(Math.abs(s["x0.55"].p - 0.30313) < 0.02, `p* ${s["x0.55"].p}`);
  assert.ok(Math.abs(s["x0.75"].u - 0.92745) < 0.05, `u* ${s["x0.75"].u}`);
  assert.ok(Math.abs(s["x0.9"].rho - 0.125) < 0.01, `undisturbed right ${s["x0.9"].rho}`);
  assert.ok(r.outputs.l1ErrorVsExact < 0.02, `L1 ${r.outputs.l1ErrorVsExact}`);
  assert.ok(r.outputs.maxCflUsed <= 0.9 + 1e-9, `maxCfl ${r.outputs.maxCflUsed}`);
});

test("the CFL gate refuses an unstable step by name, on every hyperbolic target", () => {
  for (const target of ["sod", "advection"]) {
    const r = run({ cfl: 1.5, speed: 1 }, target);
    assert.equal(r.status, "NOT_COMPUTED");
    assert.ok(r.reason.startsWith("invalid_input:cfl"), `${target}: ${r.reason}`);
  }
});

test("advection: a sine profile survives a full period, error shrinking under the estimate gate", () => {
  const r = run({ speed: 1, t: 1, mesh: 200, tol: 2e-2 }, "advection");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.l1ErrorVsExact < 0.015, `L1 ${r.outputs.l1ErrorVsExact}`);
  // the doc's stability-honesty declaration: every hyperbolic run reports
  // steps + maxCflUsed (B3 Batch A check note, 2026-11-18 — advection
  // omitted both while sod carried them). The fine march (400 cells) takes
  // round(1 / (0.9/400)) = 444 steps; the step-count rounding sets the
  // used Courant number to (1/444) / (1/400) = 0.900900… — marginally
  // above the declared 0.9, which is exactly what the field exists to
  // make auditable.
  assert.equal(r.outputs.steps, 444, `steps ${r.outputs.steps}`);
  assert.ok(Math.abs(r.outputs.maxCflUsed - 0.9009009009009009) < 1e-12, `maxCflUsed ${r.outputs.maxCflUsed}`);
});

test("heat-cn: the sin mode decays at exactly exp(-alpha pi^2 t)", () => {
  const r = run({ alpha: 0.1, t: 0.5, mesh: 32, tol: 5e-4 }, "heat-cn");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.exactCenter - Math.exp(-0.1 * Math.PI ** 2 * 0.5)) < 1e-12);
  assert.ok(r.outputs.centerError < 2e-3, `center error ${r.outputs.centerError}`);
});

test("an unattainable tolerance refuses instead of serving the coarse march", () => {
  const r = run({ mesh: 100, t: 0.2, tol: 1e-9 }, "sod");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("not_converged"), r.reason);
});
