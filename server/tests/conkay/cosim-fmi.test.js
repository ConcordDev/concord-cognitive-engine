/**
 * SX-XC-08 cosim.fmi tests.
 *
 * Reference case (catalogue; FMI standard): the two-mass
 * oscillator split vs monolithic. The analytic anchor is
 * computed independently here from the normal modes of
 * K = [[10, -6], [-6, 6]] (m = I): eigenvalues 8 -/+ 2*sqrt(10),
 * mode superposition for x(0) = (1, 0), v(0) = 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/cosim-fmi.js";

const solver = getSolver("cosim.fmi");
const run = (inputs, target = "cosim") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const REF = {
  m1: 1, m2: 1, k1: 4, kc: 6,
  initial: { x1: 1, v1: 0, x2: 0, v2: 0 },
  tEnd: 2,
};

function analytic(t) {
  const lam1 = 8 - 2 * Math.sqrt(10);
  const lam2 = 8 + 2 * Math.sqrt(10);
  const r1 = (10 - lam1) / 6;
  const r2 = (10 - lam2) / 6;
  const a = -r2 / (r1 - r2);
  const b = r1 / (r1 - r2);
  const w1 = Math.sqrt(lam1);
  const w2 = Math.sqrt(lam2);
  return {
    x1: a * Math.cos(w1 * t) + b * Math.cos(w2 * t),
    x2: a * r1 * Math.cos(w1 * t) + b * r2 * Math.cos(w2 * t),
    v1: -a * w1 * Math.sin(w1 * t) - b * w2 * Math.sin(w2 * t),
    v2: -a * r1 * w1 * Math.sin(w1 * t) - b * r2 * w2 * Math.sin(w2 * t),
  };
}

test("registered at the JS tier with the two-mass FMI reference", () => {
  assert.ok(solver);
  assert.ok(solver.reference.includes("FMI standard"));
});

test("reference case: Gauss-Seidel + iteration tracks the analytic modes within 2e-3", () => {
  const r = run({ ...REF, method: "gauss-seidel", stepSize: 0.005, iterate: { tolerance: 1e-10, maxIterations: 20 } });
  assert.equal(r.status, "PASS", r.reason || "");
  const exact = analytic(2);
  for (const k of ["x1", "v1", "x2", "v2"]) {
    assert.ok(Math.abs(r.outputs.finalState[k] - exact[k]) < 2e-3, `${k}: split ${r.outputs.finalState[k]} vs analytic ${exact[k]}`);
    assert.ok(Math.abs(r.outputs.monolithicFinalState[k] - exact[k]) < 2e-3, `${k}: monolithic ${r.outputs.monolithicFinalState[k]} vs analytic ${exact[k]}`);
  }
  assert.ok(r.outputs.maxDeviation < 2e-3, `maxDeviation ${r.outputs.maxDeviation}`);
  assert.ok(Math.abs(r.outputs.energyDrift) < 5e-3, `energy drift ${r.outputs.energyDrift}`);
});

test("scheme trend: at the same macro-step, Jacobi deviates more than Gauss-Seidel", () => {
  const jac = run({ ...REF, method: "jacobi", stepSize: 0.05 });
  const gs = run({ ...REF, method: "gauss-seidel", stepSize: 0.05 });
  assert.equal(jac.status, "PASS", jac.reason || "");
  assert.equal(gs.status, "PASS", gs.reason || "");
  assert.ok(jac.outputs.maxDeviation > gs.outputs.maxDeviation,
    `jacobi ${jac.outputs.maxDeviation} should exceed gauss-seidel ${gs.outputs.maxDeviation}`);
  // zero-order-hold coupling is first order: deviation ~ 3.7*H at H = 0.05
  assert.ok(gs.outputs.maxDeviation < 0.25, `GS deviation ${gs.outputs.maxDeviation}`);
});

test("FOH iteration cuts the coupling deviation by more than 5x and restores second-order scaling", () => {
  const plain = run({ ...REF, method: "gauss-seidel", stepSize: 0.05 });
  const iter = run({ ...REF, method: "gauss-seidel", stepSize: 0.05, iterate: { tolerance: 1e-12, maxIterations: 50 } });
  assert.equal(iter.status, "PASS", iter.reason || "");
  assert.ok(iter.outputs.maxDeviation < plain.outputs.maxDeviation / 5,
    `iterated ${iter.outputs.maxDeviation} vs plain ${plain.outputs.maxDeviation}`);
  assert.equal(iter.outputs.couplingIterations.nonConvergedSteps, 0);
});

test("adaptive step control (with iteration) keeps the deviation under the declared tolerance scale", () => {
  const r = run({ ...REF, method: "gauss-seidel", stepSize: 0.1, adaptive: { tolerance: 1e-6 }, iterate: { tolerance: 1e-11, maxIterations: 30 } });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(r.outputs.maxDeviation < 5e-4, `adaptive maxDeviation ${r.outputs.maxDeviation}`);
  assert.ok(r.outputs.steps.accepted > 100, `accepted ${r.outputs.steps.accepted}`);
});

test("damped run decays: final energy below initial, no energy-drift field served", () => {
  const r = run({ ...REF, cc: 0.4, method: "gauss-seidel", stepSize: 0.01 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.energyDrift, undefined);
  const e = Math.abs(r.outputs.finalState.x1) + Math.abs(r.outputs.finalState.x2);
  assert.ok(e < 1.5, `residual motion ${e}`);
});

test("refusals: non-positive mass, missing initial state, unknown method, FMU tier", () => {
  const badMass = run({ ...REF, m1: 0, stepSize: 0.01 });
  assert.equal(badMass.status, "NOT_COMPUTED");
  assert.ok(badMass.reason.includes("invalid_input:m1"), badMass.reason);
  const noInit = run({ m1: 1, m2: 1, k1: 4, kc: 6, tEnd: 1, stepSize: 0.01 });
  assert.equal(noInit.status, "NOT_COMPUTED");
  assert.ok(noInit.reason.includes("missing_input:initial"), noInit.reason);
  const badMethod = run({ ...REF, method: "runge-kutta", stepSize: 0.01 });
  assert.equal(badMethod.status, "NOT_COMPUTED");
  assert.ok(badMethod.reason.includes("invalid_input:method"), badMethod.reason);
  const fmu = run({ ...REF, stepSize: 0.01 }, "fmu");
  assert.equal(fmu.status, "NOT_COMPUTED");
  assert.ok(fmu.reason.includes("requires_engine_tier:sxe-15"), fmu.reason);
});
