/**
 * SX-NUM-08 math.dae tests.
 *
 * References: a manufactured index-1 DAE with the exact solution
 * y = sin t, z = cos t; the Robertson chemistry DAE (Hairer &
 * Wanner II) with its conservation law and literature state at
 * t = 0.4; and the catalogue's own reference — the Hairer &
 * Wanner Cartesian pendulum, accepted on its energy drift bound
 * and its original-constraint drift, both reported by the solver.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/dae.js";

const solver = getSolver("math.dae");
const run = (inputs, target = "dae") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the index envelope declared", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.regime.includes("index-1"));
});

test("manufactured DAE: y' = z, 0 = z - cos(t) reproduces sin / cos exactly", () => {
  const r = run({ f: ["z0"], g: ["z0 - cos(t)"], y0: [0], t0: 0, t1: Math.PI / 2, tol: 1e-10 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.y[0] - 1) < 1e-8, `y(pi/2) = ${r.outputs.y[0]}`);
  assert.ok(Math.abs(r.outputs.z[0]) < 1e-7); // cos(pi/2) = 0
  assert.equal(r.inputs.initialization, "z0 solved from g(t0, y0, z) = 0");
  assert.ok(Math.abs(r.inputs.z0[0] - 1) < 1e-9); // cos(0) = 1
});

test("an inconsistent caller z0 is corrected by the solve and the correction is reported", () => {
  const r = run({ f: ["z0"], g: ["z0 - cos(t)"], y0: [0], z0: [5], t0: 0, t1: 0.1, tol: 1e-9 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.inputs.initialization.includes("was inconsistent"));
  assert.ok(Math.abs(r.inputs.z0[0] - 1) < 1e-9);
});

test("Robertson chemistry: conservation holds and the t = 0.4 state matches the literature", () => {
  const r = run({
    f: ["-0.04*y0 + 10000*y1*z0", "0.04*y0 - 10000*y1*z0 - 30000000*y1^2"],
    g: ["y0 + y1 + z0 - 1"],
    y0: [1, 0],
    t0: 0,
    t1: 0.4,
    tol: 1e-9,
  });
  assert.equal(r.status, "PASS", r.reason || "");
  const [y1, y2] = r.outputs.y;
  const y3 = r.outputs.z[0];
  assert.ok(Math.abs(y1 + y2 + y3 - 1) < 1e-9, "mass conservation");
  // Hairer & Wanner II reference values at t = 0.4
  assert.ok(Math.abs(y1 - 0.985172) < 5e-4, `y1 = ${y1}`);
  assert.ok(Math.abs(y2 - 3.3862e-5) < 5e-6, `y2 = ${y2}`);
  assert.ok(Math.abs(y3 - 0.014794) < 5e-4, `y3 = ${y3}`);
});

test("a constraint independent of z is not index-1 and is refused by name", () => {
  const r = run({ f: ["z0"], g: ["y0 - 1"], y0: [0], t0: 0, t1: 1 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("not_index_1_or_inconsistent"), r.reason);
});

test("the pendulum: energy drift and original-constraint drift stay inside tight bounds", () => {
  const r = run({ theta0: 0.5, omega0: 0, t1: 10, tol: 1e-7 }, "pendulum");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.energyRelativeDrift < 1e-5, `energy drift ${r.outputs.energyRelativeDrift}`);
  // the twice-differentiated formulation lets the ORIGINAL
  // constraint drift slowly (the classic index-reduction drift
  // Hairer & Wanner describe); measured 1.5e-6 over 10 s at
  // tol 1e-7 — the bound is set at the level the method achieves
  assert.ok(r.outputs.constraintDrift < 1e-5, `constraint drift ${r.outputs.constraintDrift}`);
  const s = r.outputs.state;
  assert.ok(Math.abs(s.x ** 2 + s.y ** 2 - 1) < 1e-5); // same drift bound, at the final sample
  assert.ok(s.lambda > 0);
});

test("missing inputs are refused by name", () => {
  assert.ok(run({ f: ["z0"], g: ["z0 - cos(t)"], t0: 0, t1: 1 }).reason.startsWith("missing_input:y0"));
  assert.ok(run({ theta0: 0.5 }, "pendulum").reason.startsWith("missing_input:theta0"));
});
