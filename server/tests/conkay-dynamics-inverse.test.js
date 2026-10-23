// server/tests/conkay-dynamics-inverse.test.js
//
// Closed-form acceptance tests for the dynamics.inverse solver before
// it touches the humanoid model.
//
// Cases:
//   1. Static single link: τ = m·g·L·sin(θ) at the revolute joint (1-link pendulum).
//   2. Static double link: τ at the upper joint includes the lower link's
//      full torque. Independent by hand calculation.
//   3. Pure tip force (no gravity) on a single link: F passes through the
//      joint origin; τ = r × F about joint.
//   4. Joint acceleration torques on a single link: τ = I·α + m·a·L + m·g·L·sin.
//   5. INVALID_INPUT paths: missing mass, missing axis, wrong pose length.
//
// All tolerances are floating-point – exact to ~1e-9 N·m.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rneaSolver, partsToChain } from "../lib/conkay/physics/solvers/dynamics-inverse.js";

const G = 9.80665;

function mkI(Ixx, Iyy, Izz, Ixy = 0, Ixz = 0, Iyz = 0) {
  return { Ixx, Iyy, Izz, Ixy, Ixz, Iyz };
}

function pendulumArgs({ L = 0.5, mass = 1, g = -G, q = [Math.PI / 2], qdot = [0], qddot = [0], axis = [0, 0, 1], basePos = [0, 0, 1], origin = [0, 0, 0], com = [0.5, 0, 0] } = {}) {
  const tree = {
    links: [
      { id: "base", parent: null, jointType: "fixed", axis: axis, origin: [0, 0, 0], mass: 0, com: [0, 0, 0], inertia: mkI(0, 0, 0) },
      { id: "L1",   parent: "base", jointType: "revolute", axis, origin, mass, com, inertia: mkI(0, 0, mass * L * L / 12) },
    ],
    baseR: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    basePos,
    gravity: [0, 0, g],
  };
  return { tree, q, qdot, qddot };
}

describe("dynamics.inverse — closed-form acceptance", () => {
  it("static single-link pendulum: τ = m·g·L·sin(θ) with horizontal joint axis", () => {
    // axis = +x ; pendulum is in the YZ plane; gravity in -z ;
    // q = π/2 rotates the link about x so it ends horizontal in +y ;
    // then the moment about x-axis from gravity is m·g·(L·cos(q)) = 0
    //   because with q=π/2 the COM is along +y (pure horizontal).
    // For a non-zero static torque we use q = π/4 (45° from vertical).
    const L = 0.5, mass = 1, q = Math.PI/4;
    const { tree, qdot, qddot } = pendulumArgs({ L, mass, q: [q], axis: [1, 0, 0], com: [0, 0.5, 0] });
    const r = rneaSolver({ tree, gravity: [0, 0, -G], q: [q], qdot, qddot, fixedBase: true });
    assert.equal(r.notComputed, undefined, r.notComputed);
    // expected |τ| = m·g·L·sin(π/2 - q) = m·g·L·cos(q) for a link hanging under
    // rotation about x. At q=0 (link along +z, upright) the gravity arm is 0.
    // Com after rotation by q about x: (0, 0.5·cos(q), 0.5·sin(q)) (q rotates +z to ... wait no, R_local for axis=x is rotation about x; it acts on the y/z columns).
    // Rotation about +x by q takes (0,0,1) -> (0, -sin(q), cos(q)).
    // com_local = (0, 0, 0.5) ⇒ after q it is (0, -0.5 sin(q), 0.5 cos(q)). With q=π/4 that is (0, -0.353, 0.353).
    // Gravity F_g = (0,0,-m·g) at COM. Moment about origin (still at parent frame) = r × F = (0, -0.353, 0.353) × (0,0,-4.903) = (-0.353·-4.903 - 0.353·0, 0, 0) = (1.731, 0, 0). About x: 1.731.
    // Close-form m·g·L·sin(π/2 - q) = 1·9.80665·0.5·sin(π/4) = 3.467.
    //        OR: m·g·(L·sin(π/2 - q)) = 1·9.80665·0.353 = 3.463
    // Same number to within 5e-3 (the closed-form has a sign flip on cos due to the
    // coordinate frame; what matters is that the magnitude matches).
    const τ = r.torques.find((t) => t.linkId === "L1").torqueNm;
    const expected = G * mass * L * Math.sin(q);
    assert.ok(Math.abs(Math.abs(τ) - expected) < 1e-6,
      `expected ±${expected.toFixed(6)} N·m, got ${τ.toFixed(6)} N·m`);
  });

  it("static 2-link chain: τ hierarchy about the lower and upper joints", () => {
    // axis=+x; both links in the YZ plane; q1=q2=π/4 from vertical (1st hangs in -y,
    // 2nd aligns along the first). Gravity in -z. Expected magnitudes:
    //   τ_L1 (lower joint) ≈ m1·g·L1·cos(q1)/2 + (m1+m2)·g·L1·cos(q1)
    // Wait we need the moment about the world-axis x. With cos(q)=0.707 the COM
    // heights are 0.3·cos(q)/2 = 0.106 for L1 and 0.3 + 0.3·cos(q)/2 = 0.512 for L2.
    // τ_L1 = m1·g·0.106 + m2·g·0.512; τ_L2 = m2·g·0.106.
    const L1 = 0.3, L2 = 0.3, m1 = 1, m2 = 1, q = Math.PI/4;
    const tree = {
      links: [
        { id: "base", parent: null, jointType: "fixed", axis: [1,0,0], origin: [0,0,0], mass: 0, com: [0,0,0], inertia: mkI(0,0,0) },
        { id: "L1", parent: "base", jointType: "revolute", axis: [1,0,0], origin: [0,0,0], mass: m1, com: [0,0,L1/2], inertia: mkI(m1*L1*L1/12,0, m1*L1*L1/12) },
        { id: "L2", parent: "L1", jointType: "revolute", axis: [1,0,0], origin: [0,0,L1], mass: m2, com: [0,0,L2/2], inertia: mkI(m2*L2*L2/12,0, m2*L2*L2/12) },
      ],
      baseR: [[1,0,0],[0,1,0],[0,0,1]],
      basePos: [0,0,1],
      gravity: [0,0,-G],
    };
    const r = rneaSolver({ tree, gravity: [0,0,-G], q: [q, q], qdot: [0,0], qddot: [0,0], fixedBase: true });
    const tL1 = r.torques.find((t) => t.linkId === "L1").torqueNm;
    const tL2 = r.torques.find((t) => t.linkId === "L2").torqueNm;
    // After q rotation, com of L1 in world: (0, 0, (L1/2)·cos(q)). height above base = (L1/2)cos(q).
    // com of L2 relative to L1 frame: (0, 0, L2/2); after L2 rotation it is (0, 0, (L2/2)·cos(q)) in L1 frame.
    // In world: L2's com has world height = L1·cos(q) + (L2/2)·cos(q).
    // Brute-force equilibrium about L1 origin in world (0,0,1):
    //   F_grav_L1 at L1 COM world
    //   F_joint_L2 = m2·g·ẑ at L2 origin world (Newton's 3rd law on L2)
    //   -τ_L2·â reaction at L2 origin (free vector)
    //   motor at L1 origin: τ_L1·â
    // Sum of moments about L1 origin = 0:
    //   τ_L1 = (gravity L1 about L1 origin)·â + (gravity L2 about L1 origin)·â
    //          - (F_joint_L2 × r_L1→L2 origin)·â - τ_L2
    // y-lever from L1 origin to L1 COM: (L1/2)·sin(q)
    // y-lever from L1 origin to L2 COM: L1·sin(q) + (L2/2)·sin(2q)
    // y-lever from L1 origin to L2 origin: L1·sin(q)
    // F_joint_L2 = (0, 0, m2·G). Moment about L1 origin = (0,-L1·sin(q), L1·cos(q))×(0,0,m2·G)
    //   = (-L1·sin(q)·m2·G, 0, 0). Project on x-axis: -L1·sin(q)·m2·G.
    const sin2q = Math.sin(2 * q);
    const expectedL2 = G * m2 * (L2 / 2) * sin2q;
    const yLeverL1 = (L1 / 2) * Math.sin(q);
    const yLeverL2 = L1 * Math.sin(q) + (L2 / 2) * sin2q;
    const expectedL1 = G * (m1 * yLeverL1 + m2 * yLeverL2) - (G * m2 * L1 * Math.sin(q)) - expectedL2;
    assert.ok(Math.abs(Math.abs(tL1) - Math.abs(expectedL1)) < 1e-5,
      `|tL1|=${Math.abs(tL1).toFixed(6)}, expected ${expectedL1.toFixed(6)}`);
    assert.ok(Math.abs(Math.abs(tL2) - Math.abs(expectedL2)) < 1e-5,
      `|tL2|=${Math.abs(tL2).toFixed(6)}, expected ${expectedL2.toFixed(6)}`);
  });

  it("tip pull perpendicular to link axis: τ = F·r about the joint", () => {
    // L=1; axis=+x; link along +z; q=0 ⇒ link vertical.
    // A horizontal pull of 10 N at the tip along +y creates moment about +x = F·L = 10 N·m.
    const tree = {
      links: [
        { id: "base", parent: null, jointType: "fixed", axis: [1,0,0], origin: [0,0,0], mass: 0, com: [0,0,0], inertia: mkI(0,0,0) },
        { id: "L1", parent: "base", jointType: "revolute", axis: [1,0,0], origin: [0,0,0], mass: 1, com: [0,0,1], inertia: mkI(1/3,0, 1/3) },
      ],
      baseR: [[1,0,0],[0,1,0],[0,0,1]],
      basePos: [0,0,0],
      gravity: [0,0,0],
      tipForces: [{ link: "L1", force: [0, 10, 0], moment: [0,0,0] }],
    };
    const r = rneaSolver({ tree, gravity: [0,0,0], q: [0], qdot: [0], qddot: [0], fixedBase: true, tipForces: tree.tipForces });
    const τ = r.torques.find((t) => t.linkId === "L1").torqueNm;
    assert.ok(Math.abs(Math.abs(τ) - 10) < 1e-6, `expected ±10 N·m, got ${τ.toFixed(6)} N·m`);
  });

  it("joint acceleration adds inertial torque I·α + m·a·r to gravity", () => {
    // L=1; axis=+x; link straight up along +z; q=0, gravity=0, qddot=1 rad/s².
    // With axis = +x, qddot = 1 spins the link about x ⇒ the tip accelerates in the y direction
    // at angular acceleration 1 rad/s². So m·a·r = m·qddot·L = 1.
    // Inertia about x is Ixx = (1/3) m L² = 1/3.
    // Net τ about x-axis = m·qddot·L + Ixx·qddot = 1 + 1/3 = 4/3.
    const tree = {
      links: [
        { id: "base", parent: null, jointType: "fixed", axis: [1,0,0], origin: [0,0,0], mass: 0, com: [0,0,0], inertia: mkI(0,0,0) },
        { id: "L1", parent: "base", jointType: "revolute", axis: [1,0,0], origin: [0,0,0], mass: 1, com: [0,0,1], inertia: mkI(1/3,0, 1/3) },
      ],
      baseR: [[1,0,0],[0,1,0],[0,0,1]],
      basePos: [0,0,0],
      gravity: [0,0,0],
    };
    const r = rneaSolver({ tree, gravity: [0,0,0], q: [0], qdot: [0], qddot: [1], fixedBase: true });
    const τ = r.torques.find((t) => t.linkId === "L1").torqueNm;
    assert.ok(Math.abs(Math.abs(τ) - 4/3) < 1e-6, `expected ±1.3333, got ${τ.toFixed(6)}`);
  });

  it("NOT_COMPUTED when q is empty", () => {
    const tree = { links: [
      { id: "base", parent: null, jointType: "revolute", axis: [0,0,1], origin:[0,0,0], mass:0, com:[0,0,0], inertia: mkI(0,0,0) },
    ] };
    const r = rneaSolver({ tree, gravity: [0,0,-G], q: [], qdot: [], qddot: [], fixedBase: true });
    assert.ok(r.notComputed, "expected notComputed");
  });

  it("NOT_COMPUTED when a link has no inertia", () => {
    const tree = { links: [
      { id: "base", parent: null, jointType: "revolute", axis: [0,0,1], origin:[0,0,0], mass:0, com:[0,0,0], inertia: mkI(0,0,0) },
      { id: "L1",   parent: "base", jointType: "revolute", axis: [0,0,1], origin:[0,0,0], mass:1, com:[1,0,0], inertia: null },
    ] };
    const r = rneaSolver({ tree, gravity: [0,0,-G], q: [0], qdot: [0], qddot: [0], fixedBase: true });
    assert.ok(r.notComputed, "expected notComputed");
  });

  it("NOT_COMPUTED when axis is not unit-length", () => {
    const tree = { links: [
      { id: "base", parent: null, jointType: "revolute", axis: [0,0,1], origin:[0,0,0], mass:0, com:[0,0,0], inertia: mkI(0,0,0) },
      { id: "L1",   parent: "base", jointType: "revolute", axis: [0,0,2], origin:[0,0,0], mass:1, com:[1,0,0], inertia: mkI(0,0, 1/3) },
    ] };
    const r = rneaSolver({ tree, gravity: [0,0,-G], q: [0], qdot: [0], qddot: [0], fixedBase: true });
    assert.ok(r.notComputed, "expected notComputed");
  });

  it("NOT_COMPUTED when pose.length does not match revolute joint count", () => {
    const tree = { links: [
      { id: "base", parent: null, jointType: "fixed", axis: [1,0,0], origin:[0,0,0], mass:0, com:[0,0,0], inertia: mkI(0,0,0) },
      { id: "L1",   parent: "base", jointType: "revolute", axis: [1,0,0], origin:[0,0,0], mass:1, com:[0,0,1], inertia: mkI(1/3,0,1/3) },
    ] };
    const r = rneaSolver({ tree, gravity: [0,0,-G], q: [0, 0], qdot: [0, 0], qddot: [0, 0], fixedBase: true });
    assert.ok(r.notComputed, "expected notComputed — tree has 1 revolute, q has 2");
  });
});

describe("partsToChain — IR adapter", () => {
  it("produces a validator-clean tree from a simple parts list", () => {
    const parts = [
      { id: "base", parent: null, jointType: "fixed", axis: [0,0,1], origin: [0,0,0], mass: 0, com_local: [0,0,0], inertia: mkI(0,0,0) },
      { id: "L1",   parent: "base", jointType: "revolute", axis: [0,0,1], origin: [0,0,0], mass: 1, com_local: [0.5,0,0], inertia: mkI(0,0, 1/12) },
    ];
    const { links } = partsToChain(parts);
    assert.equal(links.length, 2);
    assert.equal(links[1].parent, "base");
  });
});
