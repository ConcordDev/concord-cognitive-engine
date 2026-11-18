/**
 * SX-NUM-10 math.pde-fem tests.
 *
 * The catalogue reference discipline is MMS: manufactured
 * solutions with known exact answers, accepted on the OBSERVED
 * convergence order. Cases: -u'' = pi^2 sin(pi x) with exact
 * sin(pi x); -Delta u = 2 pi^2 sin(pi x) sin(pi y) with exact
 * sin sin; the linear exactness pin -u'' = 0 with u = 1 + 2x
 * (P1 reproduces linears at the nodes); and a sabotage pin —
 * declaring the WRONG exact solution must trip the
 * observed-order refusal, because the errors then do not
 * converge at the element's rate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/pde-fem.js";

const solver = getSolver("math.pde-fem");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L4 with the MMS discipline in its regime", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 4);
  assert.ok(solver.regime.includes("observed order"));
});

test("1D MMS: -u'' = pi^2 sin(pi x), exact sin(pi x), observed order in the P1 band", () => {
  const r = run({
    f: "9.869604401089358*sin(3.141592653589793*x)",
    exact: "sin(3.141592653589793*x)",
    a: 0, b: 1, mesh: 32, tol: 1e-3,
  }, "poisson1d");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.observedOrder >= 1.7 && r.outputs.observedOrder <= 2.3, `order ${r.outputs.observedOrder}`);
  assert.ok(r.outputs.exactErrorFine < 5e-4, `fine L2 error ${r.outputs.exactErrorFine}`);
  const mid = r.outputs.nodes[Math.floor(r.outputs.nodes.length / 2)];
  assert.ok(Math.abs(mid.u - 1) < 1e-3);
});

test("1D exactness pin: -u'' = 0 with u(0) = 1, u(1) = 3 is the linear 1 + 2x at the nodes", () => {
  const r = run({ f: "0", a: 0, b: 1, uA: 1, uB: 3, mesh: 8, tol: 1e-9 }, "poisson1d");
  assert.equal(r.status, "PASS", r.reason || "");
  for (const nd of r.outputs.nodes) {
    assert.ok(Math.abs(nd.u - (1 + 2 * nd.x)) < 1e-9, `node ${nd.x}: ${nd.u}`);
  }
});

test("2D MMS: -Delta u = 2 pi^2 sin(pi x) sin(pi y) on the unit square", () => {
  const r = run({
    f: "19.739208802178716*sin(3.141592653589793*x)*sin(3.141592653589793*y)",
    exact: "sin(3.141592653589793*x)*sin(3.141592653589793*y)",
    domain: { x0: 0, x1: 1, y0: 0, y1: 1 },
    mesh: { nx: 12, ny: 12 },
    tol: 1e-2,
  }, "poisson2d");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.observedOrder >= 1.7 && r.outputs.observedOrder <= 2.3, `order ${r.outputs.observedOrder}`);
  assert.ok(Math.abs(r.outputs.centerValue - 1) < 5e-3, `center ${r.outputs.centerValue}`);
});

test("sabotage: a wrongly declared exact solution trips the observed-order refusal", () => {
  const r = run({
    f: "9.869604401089358*sin(3.141592653589793*x)",
    exact: "sin(6.283185307179586*x)", // NOT the solution of this problem
    a: 0, b: 1, mesh: 32, tol: 1e-3,
  }, "poisson1d");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("observed_order_outside_band"), r.reason);
});

test("scope and size refusals are named", () => {
  assert.ok(run({ f: "1", a: 0, b: 1, mesh: 600 }, "poisson1d").reason.startsWith("mesh_too_large"));
  assert.ok(run({ a: 0, b: 1 }, "poisson1d").reason.startsWith("missing_input:f"));
  assert.ok(run({ f: "1" }, "poisson3d").reason.startsWith("unknown_operation:poisson3d"));
});
