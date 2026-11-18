/**
 * SX-XC-09 multiphysics.couple tests.
 *
 * Reference case (catalogue pattern: preCICE CHT tutorial):
 * two conducting slabs, k1 = 200 (L = 0.05), k2 = 15
 * (L = 0.10), boundaries 100 and 20. Steady state is
 * analytic: q = 80 / (0.05/200 + 0.10/15), interface
 * T = 100 - q * 0.05/200. Thermo-elastic anchors are the
 * textbook integrals of a linear temperature profile.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/multiphysics-couple.js";

const solver = getSolver("multiphysics.couple");
const run = (inputs, target = "cht") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const CHT = {
  domainA: { length: 0.05, k: 200, rho: 2700, cp: 900, nodes: 10 },
  domainB: { length: 0.10, k: 15, rho: 8000, cp: 500, nodes: 20 },
  tempLeft: 100, tempRight: 20, initialTemp: 20,
};
const qAnalytic = 80 / (0.05 / 200 + 0.10 / 15);
const TiAnalytic = 100 - (qAnalytic * 0.05) / 200;

test("registered at the JS tier with the preCICE CHT pattern declared", () => {
  assert.ok(solver);
  assert.ok(solver.reference.includes("preCICE"));
});

test("reference case: steady CHT interface temperature and flux match the analytic values", () => {
  // a few effectively-steady implicit steps (one step leaves a
  // ~1/(lambda*dt) transient remainder): the DN iteration must
  // converge to the analytic interface state
  const r = run({ ...CHT, dt: 1e7, tEnd: 5e7, tolerance: 1e-10 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.interface.temperatureFromA - TiAnalytic) < 1e-5,
    `Ti ${r.outputs.interface.temperatureFromA} vs analytic ${TiAnalytic}`);
  assert.ok(Math.abs(r.outputs.interface.flux - qAnalytic) / qAnalytic < 1e-4,
    `flux ${r.outputs.interface.flux} vs analytic ${qAnalytic}`);
  assert.equal(r.outputs.iterations.nonConvergedSteps, 0);
});

test("transient partitioned run tracks the monolithic solution, and the deviation shrinks under refinement", () => {
  const r = run({ ...CHT, dt: 0.5, tEnd: 20, tolerance: 1e-9 });
  assert.equal(r.status, "PASS", r.reason || "");
  // the two discretizations differ at the interface control
  // volume; the deviation is a discretization measure, and
  // the verification is that it shrinks under refinement
  assert.ok(r.outputs.maxDeviationVsMonolithic < 5, `deviation ${r.outputs.maxDeviationVsMonolithic}`);
  assert.ok(r.outputs.interface.temperatureFromA > 20 && r.outputs.interface.temperatureFromA < 100);
  const fine = run({
    domainA: { ...CHT.domainA, nodes: 40 }, domainB: { ...CHT.domainB, nodes: 80 },
    tempLeft: 100, tempRight: 20, initialTemp: 20, dt: 0.1, tEnd: 20, tolerance: 1e-9,
  });
  assert.ok(fine.outputs.maxDeviationVsMonolithic < r.outputs.maxDeviationVsMonolithic / 2,
    `fine ${fine.outputs.maxDeviationVsMonolithic} vs coarse ${r.outputs.maxDeviationVsMonolithic}`);
});

test("thermo-elastic: free expansion and constrained stress match the textbook integrals", () => {
  const bar = { length: 2, E: 200e9, alpha: 12e-6, Tref: 20, nodes: 40 };
  const profile = { temperatureProfile: { T0: 20, T1: 120 } }; // mean rise = 50
  const free = run({ bar, ...profile, constraint: "free" }, "thermo-elastic");
  assert.equal(free.status, "PASS", free.reason || "");
  assert.ok(Math.abs(free.outputs.freeExpansion - 12e-6 * 2 * 50) < 1e-12, `expansion ${free.outputs.freeExpansion}`);
  assert.equal(free.outputs.stress, 0);
  const fixed = run({ bar, ...profile, constraint: "fixed" }, "thermo-elastic");
  assert.ok(Math.abs(fixed.outputs.stress - -200e9 * 12e-6 * 50) < 1, `stress ${fixed.outputs.stress}`);
  assert.ok(fixed.outputs.displacement.every((v) => v === 0));
});

test("refusals: bad domain, missing temperatures, preCICE tier", () => {
  const bad = run({ ...CHT, domainA: { length: -1, k: 1, rho: 1, cp: 1, nodes: 5 }, dt: 1, tEnd: 1 });
  assert.equal(bad.status, "NOT_COMPUTED");
  assert.ok(bad.reason.includes("invalid_input:domainA"), bad.reason);
  const noTemp = run({ domainA: CHT.domainA, domainB: CHT.domainB, dt: 1, tEnd: 1 });
  assert.equal(noTemp.status, "NOT_COMPUTED");
  assert.ok(noTemp.reason.includes("missing_input:tempLeft"), noTemp.reason);
  const eng = run({ ...CHT, dt: 1, tEnd: 1 }, "precice");
  assert.equal(eng.status, "NOT_COMPUTED");
  assert.ok(eng.reason.includes("requires_engine_tier:sxe-11"), eng.reason);
});
