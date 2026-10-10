// tests/conkay-frame-fe.test.js
//
// structure.frame: 3D frame FE + linear buckling (lib/conkay/structural/frame-fe.js,
// wrapping the fea-solver element). Verification benchmarks against published
// closed forms, then the validity range (results outside it are flagged, never a
// pass), then the two applications (car ladder-frame chassis screen, Sentinel M1
// stance leg).
//
// References for the closed forms:
//   [R] Roark's Formulas for Stress and Strain, 8th ed. (Young, Budynas, Sadegh, 2012),
//       Table 8.1 (shear, moment and deflection of straight beams): cantilever with an end
//       load; simply supported beam with a uniform load and with a centre load; beam fixed
//       at both ends with a uniform load. The same cases appear in the AISC Steel
//       Construction Manual, Table 3-23 (Shears, Moments and Deflections).
//   [K] A. Kleinlogel, Rigid Frame Formulas (F. Ungar, 1952): rectangular portal frame,
//       fixed and hinged column bases, horizontal load at the beam level. Re-derived here
//       by slope-deflection (antisymmetric sway; k = (I2/L)/(I1/h)):
//         fixed bases:  M_base = (H h/2)(1+3k)/(1+6k), M_knee = (H h/2)(3k)/(1+6k),
//                       sway = H h^3 (2+3k) / (12 E I1 (1+6k))   (k → ∞: H h^3/(24 E I1))
//         hinged bases: M_knee = H h/2 (any k).
//   [T] S. P. Timoshenko and J. M. Gere, Theory of Elastic Stability, 2nd ed. (1961),
//       ch. 2: Euler loads pi^2 EI/(K L)^2 with K = 1 (pinned-pinned), 2 (fixed-free),
//       0.5 (fixed-fixed); fixed-pinned: P = x^2 EI/L^2 with x the first root of
//       tan x = x (computed below by bisection, x ≈ 4.4934).
//   [A] AISC 360-16: E3 elastic/inelastic boundary Fy/Fe = 2.25 (Fe = 0.44 Fy); Table B4.1a
//       wall slenderness limits for rectangular (1.40 sqrt(E/Fy)) and round (0.11 E/Fy) HSS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFrame, frameValidity, sectionProps } from "../lib/conkay/structural/frame-fe.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { openDesign } from "../lib/conkay/index.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { withChassisFrame, CHASSIS_SCREEN_CHOICES } from "../lib/conkay/structural/car-chassis-frame.js";
import { buildSentinelM1IR } from "../lib/conkay/demos/sentinel-m1.js";
import { getMaterial } from "../lib/conkay/materials/index.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b} (rel ${(Math.abs(a - b) / Math.abs(b)).toExponential(2)})`);
const E = 200e9, G = E / (2 * 1.3);
const RECT = { shape: "rect", width: 0.05, height: 0.1 }; // I = b h^3 / 12
const I_RECT = (0.05 * 0.1 ** 3) / 12;
const mem = (id, i, j, o = {}) => ({ id, i, j, section: RECT, E, G, fy: 250e6, ...o });
const one = (r) => { assert.equal(r.ok, true, r.detail); return r.cases[0]; };

describe("benchmarks: beams [R]", () => {
  const L = 2;
  it("cantilever, end load: δ = PL³/3EI, θ = PL²/2EI, M_root = PL", () => {
    const P = 1000;
    const c = one(analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [mem("m", "a", "b")], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -P, 0] }] }] }));
    const d = c.nodeDisplacement("b");
    near(-d[1], (P * L ** 3) / (3 * E * I_RECT), 1e-9, "tip deflection");
    near(-d[5], (P * L ** 2) / (2 * E * I_RECT), 1e-9, "tip rotation");
    near(Math.abs(c.members[0].worst.Mz), P * L, 1e-9, "root moment");
    near(c.members[0].worst.sigma, (P * L * 0.05) / I_RECT, 1e-9, "root bending stress Mc/I");
  });
  it("the same cantilever in any 3D orientation gives the same answer (rotation invariance)", () => {
    const P = 1000, dir = [1, 2, 2].map((v) => v / 3); // unit vector
    const perp = [2, 1, -2].map((v) => v / 3); // ⟂ dir
    const c = one(analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L * dir[0], y: L * dir[1], z: L * dir[2] }], members: [mem("m", "a", "b", { yRef: perp })], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "P", nodal: [{ node: "b", F: perp.map((v) => v * P) }] }] }));
    const d = c.nodeDisplacement("b");
    near(d[0] * perp[0] + d[1] * perp[1] + d[2] * perp[2], (P * L ** 3) / (3 * E * I_RECT), 1e-9, "deflection along the load");
  });
  it("simply supported: uniform load δ = 5wL⁴/384EI, M = wL²/8; centre load δ = PL³/48EI", () => {
    const w = 1000, P = 1000;
    const model = (loadCases) => ({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "c", x: L / 2, y: 0 }, { id: "b", x: L, y: 0 }], members: [mem("m1", "a", "c"), mem("m2", "c", "b")],
      supports: [{ node: "a", fix: ["x", "y", "z", "rx", "ry"] }, { node: "b", fix: ["y", "z", "rx", "ry"] }], loadCases });
    const r = analyzeFrame(model([{ id: "w", udl: [{ member: "m1", w: [0, -w, 0] }, { member: "m2", w: [0, -w, 0] }] }, { id: "P", nodal: [{ node: "c", F: [0, -P, 0] }] }]));
    near(-r.cases[0].nodeDisplacement("c")[1], (5 * w * L ** 4) / (384 * E * I_RECT), 1e-9, "UDL midspan deflection");
    near(Math.max(...r.cases[0].members.map((m) => Math.abs(m.worst.Mz))), (w * L ** 2) / 8, 1e-9, "UDL midspan moment");
    near(-r.cases[1].nodeDisplacement("c")[1], (P * L ** 3) / (48 * E * I_RECT), 1e-9, "centre-load deflection");
    near(r.cases[0].reactions.filter((x) => x.dof === "y").reduce((s, x) => s + x.value, 0), w * L, 1e-9, "reactions balance the load");
  });
  it("fixed both ends, uniform load (out of plane): M_end = wL²/12, M_mid = wL²/24, δ = wL⁴/384EI", () => {
    const w = 1000;
    const c = one(analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [mem("m", "a", "b")], supports: [{ node: "a", fix: "fixed" }, { node: "b", fix: "fixed" }], loadCases: [{ id: "w", udl: [{ member: "m", w: [0, 0, -w] }] }] }));
    const along = c.members[0].along;
    const Iy = (0.1 * 0.05 ** 3) / 12; // out-of-plane bending uses the weak axis
    near(Math.abs(along[0].My), (w * L ** 2) / 12, 1e-9, "end moment");
    near(Math.abs(along.find((a) => Math.abs(a.at - L / 2) < 1e-12).My), (w * L ** 2) / 24, 1e-9, "midspan moment");
    const mesh = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "c", x: L / 2, y: 0 }, { id: "b", x: L, y: 0 }], members: [mem("m1", "a", "c"), mem("m2", "c", "b")], supports: [{ node: "a", fix: "fixed" }, { node: "b", fix: "fixed" }], loadCases: [{ id: "w", udl: [{ member: "m1", w: [0, 0, -w] }, { member: "m2", w: [0, 0, -w] }] }] });
    near(-mesh.cases[0].nodeDisplacement("c")[2], (w * L ** 4) / (384 * E * Iy), 1e-9, "midspan deflection");
  });
  it("agrees with the existing fea-solver path it wraps (planar frame)", () => {
    const nodes = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 3 }, { id: "c", x: 4, y: 3 }];
    const sec = sectionProps(RECT);
    const fea = runFEA({ nodes, members: [{ id: "c1", nodeI: "a", nodeJ: "b", area: sec.A, Iz: sec.Iz, Iy: sec.Iy, J: sec.J, elasticModulus: E, shearModulus: G }, { id: "b1", nodeI: "b", nodeJ: "c", area: sec.A, Iz: sec.Iz, Iy: sec.Iy, J: sec.J, elasticModulus: E, shearModulus: G }], supports: [{ nodeId: "a", fixedDOF: "fixed" }, { nodeId: "c", fixedDOF: ["x", "y", "z"] }], loads: [{ nodeId: "b", Fx: 5000, Fy: -2000 }] });
    const ours = one(analyzeFrame({ nodes, members: [mem("c1", "a", "b"), mem("b1", "b", "c")], supports: [{ node: "a", fix: "fixed" }, { node: "c", fix: ["x", "y", "z"] }], loadCases: [{ id: "L", nodal: [{ node: "b", F: [5000, -2000, 0] }] }] }, { segments: 1 }));
    const fb = fea.displacements.find((d) => d.nodeId === "b");
    const ob = ours.nodeDisplacement("b");
    near(ob[0], fb.dx, 1e-6, "dx"); near(ob[1], fb.dy, 1e-6, "dy"); near(ob[5], fb.rz, 1e-6, "rz");
  });
});

describe("benchmarks: portal frame [K]", () => {
  const h = 4, Lb = 6, H = 10000;
  const col = { shape: "rect", width: 0.2, height: 0.3 }, I1 = (0.2 * 0.3 ** 3) / 12;
  // The closed forms neglect axial deformation. axiallyRigid = true gives every member the
  // same I with A × 1e6 (a "properties" section): the FE must then reproduce them to 1e-5
  // (the residual axial compliance of A × 1e6 is of order 1e-6).
  // With the real rectangular sections the columns' axial shortening (one in tension, one in
  // compression) softens the sway slightly: agreement within 0.5 % is the stated tolerance.
  const rigidA = (sec) => { const p = sectionProps(sec); return { shape: "properties", A: p.A * 1e6, Iz: p.Iz, Iy: p.Iy, J: p.J, cy: p.cy, cz: p.cz }; };
  const portal = (beamHeight, base, axiallyRigid = false) => {
    const beam0 = { shape: "rect", width: 0.2, height: beamHeight };
    const beam = axiallyRigid ? rigidA(beam0) : beam0;
    const colS = axiallyRigid ? rigidA(col) : col;
    const I2 = (0.2 * beamHeight ** 3) / 12;
    const r = analyzeFrame({
      nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 0, y: h }, { id: "C", x: Lb, y: h }, { id: "D", x: Lb, y: 0 }],
      members: [mem("AB", "A", "B", { section: colS }), mem("BC", "B", "C", { section: beam }), mem("CD", "C", "D", { section: colS })],
      supports: [{ node: "A", fix: base }, { node: "D", fix: base }],
      loadCases: [{ id: "H", nodal: [{ node: "B", F: [H, 0, 0] }] }],
    });
    return { c: one(r), k: (I2 / Lb) / (I1 / h) };
  };
  // Planar frame in XY: hinged = no out-of-plane freedom left either (restrain z, rx, ry at the bases).
  const HINGE = ["x", "y", "z", "rx", "ry"];
  for (const beamHeight of [0.3, 0.45, 0.6]) {
    for (const [rigid, tol] of [[true, 1e-5], [false, 5e-3]]) {
      it(`fixed bases, beam ${beamHeight * 1000} mm, ${rigid ? "axially rigid (exact)" : "real sections (within 0.5 %)"}: base / knee moments and sway`, () => {
        const { c, k } = portal(beamHeight, "fixed", rigid);
        const col1 = c.members.find((m) => m.id === "AB").along;
        near(Math.abs(col1[0].Mz), ((H * h) / 2) * ((1 + 3 * k) / (1 + 6 * k)), tol, "base moment");
        near(Math.abs(col1.at(-1).Mz), ((H * h) / 2) * ((3 * k) / (1 + 6 * k)), tol, "knee moment");
        near(c.nodeDisplacement("B")[0], (H * h ** 3 * (2 + 3 * k)) / (12 * E * I1 * (1 + 6 * k)), tol, "sway");
      });
    }
  }
  it("hinged bases: knee moment = H h / 2 for any beam stiffness", () => {
    for (const bh of [0.3, 0.6]) {
      // equal base shears follow from antisymmetry when axial strain is neglected
      const { c } = portal(bh, HINGE, true);
      near(Math.abs(c.members.find((m) => m.id === "AB").along.at(-1).Mz), (H * h) / 2, 1e-5, `knee moment (beam ${bh})`);
      const real = portal(bh, HINGE).c;
      near(Math.abs(real.members.find((m) => m.id === "AB").along.at(-1).Mz), (H * h) / 2, 5e-3, `knee moment, real sections (beam ${bh})`);
    }
  });
  it("a nearly rigid beam gives the fixed-guided sway H h³ / (24 E I1)", () => {
    const { c } = portal(3.0, "fixed", true); // k ≈ 667
    near(c.nodeDisplacement("B")[0], (H * h ** 3) / (24 * E * I1), 1e-3, "sway (finite k: the closed form above gives the exact value)");
  });
});

describe("benchmarks: Euler buckling [T]", () => {
  const Lc = 3, Ea = 69e9, Ga = Ea / (2 * 1.33);
  const tube = { shape: "round-tube", od: 0.05, wall: 0.003 };
  const I = sectionProps(tube).Iz;
  const column = (supports, segments = 8) => analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: Lc, y: 0 }], members: [{ id: "c", i: "a", j: "b", section: tube, E: Ea, G: Ga }], supports, loadCases: [{ id: "P", nodal: [{ node: "b", F: [-1000, 0, 0] }] }] }, { segments, buckling: ["P"] }).cases[0].buckling.factor * 1000;
  // first root of tan x = x above pi (bisection on f = sin x − x cos x)
  let lo = Math.PI + 1e-6, hi = 1.5 * Math.PI - 1e-6;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; ((Math.sin(m) - m * Math.cos(m)) * (Math.sin(lo) - lo * Math.cos(lo)) > 0) ? (lo = m) : (hi = m); }
  const xFP = (lo + hi) / 2;
  const cases = [
    ["pinned-pinned", [{ node: "a", fix: ["x", "y", "z", "rx"] }, { node: "b", fix: ["y", "z"] }], Math.PI ** 2 / 1],
    ["fixed-free", [{ node: "a", fix: "fixed" }], Math.PI ** 2 / 4],
    ["fixed-fixed", [{ node: "a", fix: "fixed" }, { node: "b", fix: ["y", "z", "rx", "ry", "rz"] }], 4 * Math.PI ** 2],
    ["fixed-pinned", [{ node: "a", fix: "fixed" }, { node: "b", fix: ["y", "z", "rx"] }], xFP ** 2],
  ];
  for (const [name, sup, coef] of cases) {
    it(`${name}: P_cr = ${coef.toFixed(4)} EI/L² within 0.2 % at 8 elements`, () => {
      near(column(sup), (coef * Ea * I) / Lc ** 2, 2e-3, name);
    });
  }
  it("converges with mesh refinement (pinned-pinned error falls by > 10x from 2 to 8 elements)", () => {
    const exact = (Math.PI ** 2 * Ea * I) / Lc ** 2;
    const e2 = Math.abs(column(cases[0][1], 2) - exact), e8 = Math.abs(column(cases[0][1], 8) - exact);
    assert.ok(e8 < e2 / 10, `${e2} → ${e8}`);
    assert.ok(Math.abs(xFP - 4.4934) < 1e-4);
  });
});

describe("validity range: results outside it are flagged, not passed", () => {
  const steel = { E: 200e9, G: 200e9 / 2.6, fy: 250e6 };
  const col = (section, Lc, P, supports = [{ node: "a", fix: "fixed" }]) => {
    const r = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: Lc, y: 0 }], members: [{ id: "m", i: "a", j: "b", section, ...steel }], supports, loadCases: [{ id: "P", nodal: [{ node: "b", F: P }] }] }, { buckling: ["P"] });
    return frameValidity(r, r.cases[0]).flags.map((f) => f.code);
  };
  it("flags inelastic buckling of a stocky column (AISC E3)", () => {
    assert.ok(col({ shape: "rect", width: 0.1, height: 0.1 }, 1.2, [-1000, 0, 0]).includes("inelastic_buckling"));
    assert.ok(!col({ shape: "rect", width: 0.02, height: 0.02 }, 3, [-1000, 0, 0]).includes("inelastic_buckling"));
  });
  it("flags yield, deep members, slender walls and large displacements", () => {
    assert.ok(col({ shape: "rect", width: 0.02, height: 0.02 }, 1, [0, -5000, 0]).includes("beyond_yield"));
    assert.ok(col({ shape: "rect", width: 0.2, height: 0.3 }, 1, [0, -1000, 0]).includes("deep_member"));
    assert.ok(col({ shape: "round-tube", od: 0.5, wall: 0.002 }, 6, [0, -10, 0]).includes("slender_wall"));
    assert.ok(col({ shape: "rect", width: 0.01, height: 0.01 }, 3, [0, -100, 0]).includes("large_displacement"));
  });
  it("reports a mechanism instead of solving it", () => {
    const r = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }], members: [mem("m", "a", "b")], supports: [{ node: "a", fix: ["x", "y", "z"] }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -1, 0] }] }] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "mechanism");
  });
});

describe("structure.frame applications", () => {
  it("car: ladder-frame chassis screen from the car's rails (bending + torsional stiffness)", () => {
    const b = buildCarFromLibrary("Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.", { cadBody: false });
    const s = openDesign(withChassisFrame(b.ir)).session;
    const env = s.result("structure.frame@CHASSIS");
    assert.ok(["PASS", "WARN"].includes(env.status), env.reason);
    const gross = s.result("mass.assembly@VEH").outputs.grossMass.value;
    near(env.outputs["bending.reactionSum"].value[2], gross * 9.80665 * CHASSIS_SCREEN_CHOICES.loadFactor.value, 1e-9, "vertical reactions = 2 g gross weight");
    // Hand check: symmetric load → no cross-member action; each rail is an overhanging beam
    // (overhangs a, c, span l) under q = (gross·g·2/2)/rail length. Peak moment between supports.
    const veh = b.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    const fx = parseFloat(veh.frontAxleX), rx = parseFloat(veh.rearAxleX), x0 = 2.3 - 1.8, x1 = 2.3 + 1.8;
    const q = (gross * 9.80665 * 2) / 2 / 3.6, a = fx - x0, l = rx - fx, c = x1 - rx;
    const T = a + l + c;
    const RA = (q * T * (a + l - T / 2)) / l; // ΣM about the rear support = 0
    const M = (x) => -q * x * x / 2 + (x > a ? RA * (x - a) : 0); // valid up to the rear support
    let Mmax = 0;
    for (let i = 0; i <= 10000; i++) Mmax = Math.max(Mmax, Math.abs(M(((a + l) * i) / 10000)));
    const rail = getMaterial("aluminum-6061-t6");
    const sec = sectionProps({ shape: "i-beam", height: 0.12, flangeWidth: 0.08, flangeThickness: 0.006, webThickness: 0.004 });
    near(env.outputs["bending.maxVonMises"].value, (Mmax * sec.cy) / sec.Iz, 1e-3, "rail bending stress vs hand statics (strong axis vertical)");
    assert.ok(rail.yieldPa > 0);
    const kt = env.outputs["stiffness.torsional"];
    assert.ok(kt.value > 0 && Number.isFinite(kt.perDegree));
    // editing the rail section re-runs the frame and stiffens it
    const before = env.outputs["bending.maxVonMises"].value;
    s.engine.applyEdits([{ node: "RAIL_L", path: "geometry.height", value: 0.16 }, { node: "RAIL_R", path: "geometry.height", value: 0.16 }], { source: "test" });
    assert.ok(s.result("structure.frame@CHASSIS").outputs["bending.maxVonMises"].value < before);
  });
  it("Sentinel M1: stance leg buckling matches π²EI/(4L²); the closed budget passes, with the mass at the limit", () => {
    const s = openDesign(buildSentinelM1IR({ batteryParallel: 5, bracket: "sq-1x0.065" })).session;
    const env = s.result("structure.frame@sentinel");
    assert.equal(env.status, "PASS", (env.warnings || []).join(" | "));
    assert.equal(s.result("mass.budget@sentinel").outputs.unknownCount.value, 0);
    const known = s.result("mass.budget@sentinel").outputs.knownMass.value;
    const W = known * 9.80665 * 2;
    const g = s.graph.node("shin-l").geometry;
    const I = sectionProps({ shape: "rect-tube", width: g.width, height: g.height, wall: g.wall }).Iz;
    const Lleg = 1.817 - 0.061;
    near(env.outputs["single-support.bucklingFactor"].value * W, (Math.PI ** 2 * 68.9e9 * I) / (4 * Lleg ** 2), 2e-3, "fixed-free leg");
    const lim = env.outputs["single-support.loadToLimit"].value;
    assert.equal(lim.governs, "buckling");
    near(lim.totalMassKg, known * (env.outputs["single-support.bucklingFactor"].value / 2), 1e-9, "mass at the limit (required factor 2)");
    for (const m of env.margins) assert.ok(m.utilization < 1, m.check);
  });
});
