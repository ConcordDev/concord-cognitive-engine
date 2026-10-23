// server/tests/conkay-mass-inertia-moment.test.js
//
// Closed-form acceptance tests for mass.inertia-moment.
//
// Cases:
//   1. Single box, m=1, dims 2×2×2 ⇒ Ixx = Iyy = Izz = 1/12·(4+4) = 2/3.
//   2. Single cylinder, m=2, r=0.5, h=2 ⇒ Izz = m/2·r² = 0.25,
//                                          Ixx = Iyy = m/12·(3r²+h²) = 19/24 ≈ 0.7916667.
//   3. Single sphere, m=3, r=0.4 ⇒ I = 2/5·3·0.16 = 0.192.
//   4. Two identical boxes side by side ⇒ assembly Izz > single box Izz
//      (parallel-axis theorem strictly adds the d⊗d contribution).
//   5. Missing parts ⇒ not_computed.
//   6. Unknown shape ⇒ not_computed with the offending part id in the reason.
//   7. totalMassKg cross-check ⇒ massErrorPct ≈ 0 when totals match.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inertiaMoment } from "../lib/conkay/physics/solvers/mass-inertia-moment.js";

describe("mass.inertia-moment — per-part and assembly inertia tensor", () => {
  it("single box m=1, dims 2×2×2 ⇒ Ixx=Iyy=Izz = 2/3 ≈ 0.6666667", () => {
    const r = inertiaMoment({
      parts: [
        { id: "b1", massKg: 1, shape: "box", dims: { x: 2, y: 2, z: 2 }, comLocal: [0, 0, 0] },
      ],
    });
    assert.equal(r.status, "ok");
    const { ownCom, worldTensor } = r.parts[0];
    assert.ok(Math.abs(ownCom[0].Ixx - 2 / 3) < 1e-9, `Ixx expected 2/3, got ${ownCom[0].Ixx}`);
    assert.ok(Math.abs(ownCom[0].Iyy - 2 / 3) < 1e-9, `Iyy expected 2/3, got ${ownCom[0].Iyy}`);
    assert.ok(Math.abs(ownCom[0].Izz - 2 / 3) < 1e-9, `Izz expected 2/3, got ${ownCom[0].Izz}`);
    assert.equal(ownCom[0].Ixy, 0);
    assert.equal(ownCom[0].Ixz, 0);
    assert.equal(ownCom[0].Iyz, 0);
    // The assembly tensor at the part's own COM is the own tensor (d=0).
    assert.ok(Math.abs(worldTensor[0][0] - 2 / 3) < 1e-9);
    assert.ok(Math.abs(worldTensor[1][1] - 2 / 3) < 1e-9);
    assert.ok(Math.abs(worldTensor[2][2] - 2 / 3) < 1e-9);
    // Invariants: trace = 3·(2/3) = 2.
    assert.ok(Math.abs(r.invariants.trace - 2) < 1e-9);
  });

  it("single cylinder m=2, r=0.5, h=2 ⇒ Izz = 0.25, Ixx=Iyy = 19/24 ≈ 0.7916667", () => {
    const r = inertiaMoment({
      parts: [
        { id: "c1", massKg: 2, shape: "cylinder", dims: { r: 0.5, h: 2 }, comLocal: [0, 0, 0] },
      ],
    });
    assert.equal(r.status, "ok");
    const { ownCom, worldTensor } = r.parts[0];
    assert.ok(Math.abs(ownCom[0].Izz - 0.25) < 1e-9, `Izz expected 0.25, got ${ownCom[0].Izz}`);
    const expected = (2 / 12) * (3 * 0.5 * 0.5 + 2 * 2); // 0.7916667
    assert.ok(Math.abs(ownCom[0].Ixx - expected) < 1e-6, `Ixx expected ${expected}, got ${ownCom[0].Ixx}`);
    assert.ok(Math.abs(ownCom[0].Iyy - expected) < 1e-6, `Iyy expected ${expected}, got ${ownCom[0].Iyy}`);
    assert.equal(ownCom[0].Ixy, 0);
    assert.equal(ownCom[0].Ixz, 0);
    assert.equal(ownCom[0].Iyz, 0);
    // Assembly tensor diagonal at own COM.
    assert.ok(Math.abs(worldTensor[0][0] - expected) < 1e-6);
    assert.ok(Math.abs(worldTensor[1][1] - expected) < 1e-6);
    assert.ok(Math.abs(worldTensor[2][2] - 0.25) < 1e-9);
  });

  it("single sphere m=3, r=0.4 ⇒ I = 2/5·3·0.16 = 0.192", () => {
    const r = inertiaMoment({
      parts: [
        { id: "s1", massKg: 3, shape: "sphere", dims: { r: 0.4 }, comLocal: [0, 0, 0] },
      ],
    });
    assert.equal(r.status, "ok");
    const own = r.parts[0].ownCom[0];
    assert.ok(Math.abs(own.Ixx - 0.192) < 1e-9, `Ixx expected 0.192, got ${own.Ixx}`);
    assert.ok(Math.abs(own.Iyy - 0.192) < 1e-9, `Iyy expected 0.192, got ${own.Iyy}`);
    assert.ok(Math.abs(own.Izz - 0.192) < 1e-9, `Izz expected 0.192, got ${own.Izz}`);
    assert.equal(own.Ixy, 0);
    assert.equal(own.Ixz, 0);
    assert.equal(own.Iyz, 0);
    // For a sphere at the origin the assembly tensor equals the own tensor.
    assert.ok(Math.abs(r.assemblyTensor[0][0] - 0.192) < 1e-9);
    assert.ok(Math.abs(r.assemblyTensor[1][1] - 0.192) < 1e-9);
    assert.ok(Math.abs(r.assemblyTensor[2][2] - 0.192) < 1e-9);
    // Sphere is isotropic ⇒ principal moments all equal own diagonal.
    assert.ok(r.principalMoments.I1 != null && r.principalMoments.I2 != null && r.principalMoments.I3 != null);
    assert.ok(Math.abs(r.principalMoments.I1 - 0.192) < 1e-9);
    assert.ok(Math.abs(r.principalMoments.I2 - 0.192) < 1e-9);
    assert.ok(Math.abs(r.principalMoments.I3 - 0.192) < 1e-9);
  });

  it("two identical boxes side by side ⇒ assembly Izz strictly greater than a single box's Izz", () => {
    // Box of m=2, dims 2×2×2 placed at x = ±1 (so d = 1 m along x). Single-box
    // own inertia about any axis = m/12·(sum of squared perpendiculars) = 4/3.
    // The parallel-axis increment for each box is m·(|d|²·I₃ − d⊗d) with
    // d=(±1,0,0), so each box adds 2·(I₃ − diag(1,0,0)) = diag(0, 2, 2): 0
    // to Ixx (the d⊗d cancels the |d|² term exactly along the offset axis),
    // and 2 to Iyy and Izz. With two boxes the assembly Izz = 2·4/3 + 2·2 = 20/3.
    const single = inertiaMoment({
      parts: [{ id: "lonely", massKg: 2, shape: "box", dims: { x: 2, y: 2, z: 2 }, comLocal: [0, 0, 0] }],
    });
    assert.equal(single.status, "ok");
    const singleIzz = single.parts[0].ownCom[0].Izz;
    assert.ok(Math.abs(singleIzz - 4 / 3) < 1e-9, `single-box own Izz expected 4/3, got ${singleIzz}`);

    const pair = inertiaMoment({
      parts: [
        { id: "left",  massKg: 2, shape: "box", dims: { x: 2, y: 2, z: 2 }, comLocal: [-1, 0, 0] },
        { id: "right", massKg: 2, shape: "box", dims: { x: 2, y: 2, z: 2 }, comLocal: [ 1, 0, 0] },
      ],
    });
    assert.equal(pair.status, "ok");
    const assemblyIzz = pair.assemblyTensor[2][2];
    assert.ok(assemblyIzz > singleIzz, `expected assemblyIzz (${assemblyIzz}) > singleIzz (${singleIzz})`);
    assert.ok(Math.abs(assemblyIzz - (20 / 3)) < 1e-9, `expected 20/3 ≈ 6.6667, got ${assemblyIzz}`);
    // Ixx sums two own tensors with no parallel-axis contribution (the d⊗d
    // cancels |d|² exactly along the offset axis).
    assert.ok(Math.abs(pair.assemblyTensor[0][0] - (8 / 3)) < 1e-9, `expected Ixx = 8/3, got ${pair.assemblyTensor[0][0]}`);
    // COM sits at the midpoint between the two equal-mass boxes.
    assert.ok(Math.abs(pair.assemblyCom[0]) < 1e-9);
    assert.ok(Math.abs(pair.assemblyCom[1]) < 1e-9);
    assert.ok(Math.abs(pair.assemblyCom[2]) < 1e-9);
    // Total mass = 4.
    assert.ok(Math.abs(pair.totalMassKg - 4) < 1e-9);
    // The Ixy, Ixz, Iyz products are zero for this symmetric arrangement.
    assert.ok(Math.abs(pair.assemblyTensor[0][1]) < 1e-9);
    assert.ok(Math.abs(pair.assemblyTensor[0][2]) < 1e-9);
    assert.ok(Math.abs(pair.assemblyTensor[1][2]) < 1e-9);
  });

  it("missing parts ⇒ status not_computed", () => {
    const r1 = inertiaMoment({ parts: undefined });
    assert.equal(r1.status, "not_computed");
    assert.match(r1.reason, /parts required/);

    const r2 = inertiaMoment({ parts: [] });
    assert.equal(r2.status, "not_computed");
    assert.match(r2.reason, /parts required/);
  });

  it("unknown shape ⇒ status not_computed with offending part id in reason", () => {
    const r = inertiaMoment({
      parts: [
        { id: "ok",  massKg: 1, shape: "box", dims: { x: 1, y: 1, z: 1 }, comLocal: [0, 0, 0] },
        { id: "bad", massKg: 1, shape: "tetrahedron", dims: {}, comLocal: [0, 0, 0] },
      ],
    });
    assert.equal(r.status, "not_computed");
    assert.match(r.reason, /part bad/);
    assert.match(r.reason, /unknown shape/);
  });

  it("totalMassKg cross-check ⇒ massErrorPct ≈ 0 when totals match", () => {
    const r = inertiaMoment({
      parts: [
        { id: "a", massKg: 1.5, shape: "box",      dims: { x: 1, y: 1, z: 1 }, comLocal: [0, 0, 0] },
        { id: "b", massKg: 2.5, shape: "sphere",   dims: { r: 0.3 },           comLocal: [1, 0, 0] },
      ],
      totalMassKg: 4.0,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.totalMassKg, 4.0);
    assert.ok(r.massErrorPct !== null);
    assert.ok(Math.abs(r.massErrorPct) < 1e-9, `expected massErrorPct ≈ 0, got ${r.massErrorPct}`);

    // Mismatch case ⇒ massErrorPct > 0 and equals 100·|Δ|/reference.
    const r2 = inertiaMoment({
      parts: [
        { id: "a", massKg: 3, shape: "box", dims: { x: 1, y: 1, z: 1 }, comLocal: [0, 0, 0] },
      ],
      totalMassKg: 4.0,
    });
    assert.equal(r2.status, "ok");
    assert.ok(Math.abs(r2.massErrorPct - 25) < 1e-9, `expected 25%, got ${r2.massErrorPct}`);
  });
});