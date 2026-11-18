/**
 * SX-NUM-24 math.tensor-continuum tests.
 *
 * Reference case (catalogue, Holzapfel, Nonlinear Solid
 * Mechanics): the von Mises stress of a pure shear state
 * tau is sqrt(3)*tau, principal stresses {tau, 0, -tau}.
 * Strain references are the textbook uniaxial and simple-
 * shear deformation gradients, computed by hand.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/tensor-continuum.js";

const solver = getSolver("math.tensor-continuum");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test("registered at L1 with the pure-shear reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 1);
  assert.ok(solver.reference.includes("pure shear"));
});

test("reference case: von Mises of pure shear is sqrt(3)*tau", () => {
  const tau = 100;
  const r = run({ stress: [[0, tau, 0], [tau, 0, 0], [0, 0, 0]] }, "von-mises");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.vonMises, Math.sqrt(3) * tau, 1e-12), `vonMises ${r.outputs.vonMises}`);
  assert.deepEqual(r.outputs.principalStresses.map((v) => Math.round(v * 1e9) / 1e9), [100, 0, -100]);
  assert.ok(near(r.outputs.hydrostatic, 0), `hydrostatic ${r.outputs.hydrostatic}`);
  assert.ok(near(r.outputs.J2, tau * tau), `J2 ${r.outputs.J2}`);
  assert.ok(near(r.outputs.maxShear, tau), `maxShear ${r.outputs.maxShear}`);
});

test("hydrostatic state: von Mises and J2 vanish, mean stress is the pressure", () => {
  const r = run({ stress: [[50, 0, 0], [0, 50, 0], [0, 0, 50]] }, "von-mises");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.vonMises, 0), `vonMises ${r.outputs.vonMises}`);
  assert.ok(near(r.outputs.hydrostatic, 50));
  assert.ok(near(r.outputs.J2, 0), `J2 ${r.outputs.J2}`);
});

test("invariants of diag(1,2,3): I1=6, I2=11, I3=6 by both routes", () => {
  const r = run({ tensor: [[1, 0, 0], [0, 2, 0], [0, 0, 3]] }, "invariants");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.I1, 6) && near(r.outputs.I2, 11) && near(r.outputs.I3, 6),
    JSON.stringify(r.outputs));
  assert.ok(near(r.outputs.frobeniusNorm, Math.sqrt(14)), `frobenius ${r.outputs.frobeniusNorm}`);
});

test("principal values of [[2,1,0],[1,2,0],[0,0,3]] are 3, 3, 1 with unit directions", () => {
  const r = run({ tensor: [[2, 1, 0], [1, 2, 0], [0, 0, 3]] }, "principal");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.deepEqual(r.outputs.principalValues.map((v) => Math.round(v * 1e9) / 1e9), [3, 3, 1]);
  for (const d of r.outputs.principalDirections) assert.ok(near(Math.hypot(...d), 1, 1e-9));
});

test("transform: rotating diag(1,2,3) by 90 degrees about z gives diag(2,1,3), invariants kept", () => {
  const Rz = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const r = run({ tensor: [[1, 0, 0], [0, 2, 0], [0, 0, 3]], rotation: Rz }, "transform");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.rotated[0][0], 2) && near(r.outputs.rotated[1][1], 1) && near(r.outputs.rotated[2][2], 3),
    JSON.stringify(r.outputs.rotated));
  assert.ok(near(r.outputs.invariants.I1, 6) && near(r.outputs.invariants.I2, 11) && near(r.outputs.invariants.I3, 6));
});

test("transform refusals: a reflection and a scaled matrix are not rotations", () => {
  const T = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];
  const refl = run({ tensor: T, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, -1]] }, "transform");
  assert.equal(refl.status, "NOT_COMPUTED");
  assert.ok(refl.reason.includes("not +1"), refl.reason);
  const scaled = run({ tensor: T, rotation: [[2, 0, 0], [0, 2, 0], [0, 0, 2]] }, "transform");
  assert.equal(scaled.status, "NOT_COMPUTED");
  assert.ok(scaled.reason.includes("not orthonormal"), scaled.reason);
});

test("strain: uniaxial stretch 1.5 — E11 = 0.625, J = 1.5, stretches {1.5, 1, 1}", () => {
  const r = run({ F: [[1.5, 0, 0], [0, 1, 0], [0, 0, 1]] }, "strain");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.J, 1.5), `J ${r.outputs.J}`);
  assert.ok(near(r.outputs.greenLagrange[0][0], 0.625), `E11 ${r.outputs.greenLagrange[0][0]}`);
  assert.deepEqual(r.outputs.principalStretches.map((v) => Math.round(v * 1e9) / 1e9), [1.5, 1, 1]);
  assert.ok(near(r.outputs.logStrains[0], Math.log(1.5), 1e-9), `log strain ${r.outputs.logStrains[0]}`);
  assert.ok(near(r.outputs.polarRotation[0][0], 1) && near(r.outputs.polarRotation[1][1], 1));
});

test("strain: simple shear gamma=0.5 — C12 = 0.5, C22 = 1.25, E12 = 0.25, J = 1", () => {
  const r = run({ F: [[1, 0.5, 0], [0, 1, 0], [0, 0, 1]] }, "strain");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(near(r.outputs.J, 1), `J ${r.outputs.J}`);
  assert.ok(near(r.outputs.rightCauchyGreen[0][1], 0.5), `C12 ${r.outputs.rightCauchyGreen[0][1]}`);
  assert.ok(near(r.outputs.rightCauchyGreen[1][1], 1.25), `C22 ${r.outputs.rightCauchyGreen[1][1]}`);
  assert.ok(near(r.outputs.greenLagrange[0][1], 0.25), `E12 ${r.outputs.greenLagrange[0][1]}`);
});

test("refusals: J <= 0, asymmetry, NaN, missing input, engine tier", () => {
  const inv = run({ F: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] }, "strain");
  assert.equal(inv.status, "NOT_COMPUTED");
  assert.ok(inv.reason.includes("J > 0"), inv.reason);
  const asym = run({ tensor: [[0, 2, 0], [0, 0, 0], [0, 0, 0]] }, "invariants");
  assert.equal(asym.status, "NOT_COMPUTED");
  assert.ok(asym.reason.includes("not symmetric"), asym.reason);
  const nan = run({ tensor: [[1, 0, 0], [0, Number.NaN, 0], [0, 0, 1]] }, "invariants");
  assert.equal(nan.status, "NOT_COMPUTED");
  assert.ok(nan.reason.includes("invalid_input:tensor"), nan.reason);
  const missing = run({}, "invariants");
  assert.equal(missing.status, "NOT_COMPUTED");
  assert.ok(missing.reason.includes("missing_input:tensor"), missing.reason);
  const sym = run({ tensor: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, "symbolic");
  assert.equal(sym.status, "NOT_COMPUTED");
  assert.ok(sym.reason.includes("requires_engine_tier:sxe-02"), sym.reason);
});
