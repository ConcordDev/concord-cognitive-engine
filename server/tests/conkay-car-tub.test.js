// server/tests/conkay-car-tub.test.js
//
// The car's structural tub (structural/car-tub.js) and what it needed from
// the frame solver: Timoshenko members, Bredt closed-section torsion, shear
// panels as equivalent diagonals, plate buckling checks. Each benchmark is a
// closed form with its source:
//   - Timoshenko cantilever / fixed-guided: bending + shear deflection,
//     delta = P L^3 / 3EI + P L / (G As)  and  P L^3 / 12EI + P L / (G As)
//     (Timoshenko & Gere, Mechanics of Materials; Roark's Formulas 8th ed.,
//     ch. 8, transverse shear deflection);
//   - Bredt-Batho single-cell torsion: J = 4 Am^2 / (perimeter / t), twist
//     T L / G J (Megson, Aircraft Structures for Engineering Students, ch. 18);
//   - shear panel: delta = V b / (G t a) (tau = G gamma);
//   - plate shear buckling k_s = 5.35 + 4 (b/a)^2 (Timoshenko & Gere, Theory of
//     Elastic Stability, sec. 9.7).
// Then the car: the tub's torsional stiffness against the cited target, the
// mass and CG it costs, and its fit to the packaging envelopes and egress
// lines. The CAD-body skin check needs the OCC kernel (skipped without it).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeFrame, sectionProps, plateLocalBuckling, frameValidity } from "../lib/conkay/structural/frame-fe.js";
import { panelDiagonals, plateShearBuckling, panelShear } from "../lib/conkay/structural/shear-panel.js";
import { withStructuralTub, tubLayout, tubPackagingFit, tubPartBox, TORSION_TARGET, TUB_DESIGN_CHOICES } from "../lib/conkay/structural/car-tub.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { DesignGraph } from "../lib/conkay/graph/design-graph.js";
import { cadBodyRequest } from "../lib/conkay/physics/solvers/cad-body.js";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";
import { runTubFitKernelAsync } from "../lib/conkay/cad/tub-fit-kernel.js";
import { obb } from "../lib/conkay/packaging/geometry.js";
import { withChassisFrame } from "../lib/conkay/structural/car-chassis-frame.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
const E = 70e9, G = 26e9;
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

describe("Timoshenko members (shearDeformation)", () => {
  const sec = { shape: "rect", width: 0.05, height: 0.2 }; // deep: shear deflection matters
  const sp = sectionProps(sec);
  const L = 0.6, P = 1000;
  const cantilever = (shearDeformation) => analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [{ id: "m", i: "a", j: "b", section: sec, E, G }], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -P, 0] }] }], shearDeformation }).cases[0].nodeDisplacement("b")[1];
  it("cantilever tip: P L³/3EI + P L/(G As), As = 5/6 A", () => {
    near(-cantilever(true), (P * L ** 3) / (3 * E * sp.Iz) + (P * L) / (G * sp.Asy), 1e-9, "Timoshenko tip deflection");
    near(-cantilever(false), (P * L ** 3) / (3 * E * sp.Iz), 1e-9, "default stays Euler-Bernoulli");
  });
  it("fixed-guided (sway) member: P L³/12EI + P L/(G As)", () => {
    const r = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [{ id: "m", i: "a", j: "b", section: sec, E, G }], supports: [{ node: "a", fix: "fixed" }, { node: "b", fix: ["x", "z", "rx", "ry", "rz"] }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -P, 0] }] }], shearDeformation: true });
    near(-r.cases[0].nodeDisplacement("b")[1], (P * L ** 3) / (12 * E * sp.Iz) + (P * L) / (G * sp.Asy), 1e-9, "guided end");
  });
  it("shear stress V/As is added to the torsional shear with shear deformation only", () => {
    const run = (sd) => analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [{ id: "m", i: "a", j: "b", section: sec, E, G }], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -P, 0] }] }], shearDeformation: sd }).cases[0].members[0].worst;
    near(run(true).tau, P / sp.Asy, 1e-9, "V/As");
    assert.equal(run(false).tau, 0);
  });
  it("beam-theory validity: L/d ≥ 2 with shear deformation, judged on the physical member's length", () => {
    const mk = (Lm, checkLength) => {
      const r = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: Lm, y: 0 }], members: [{ id: "m", i: "a", j: "b", section: sec, E, G, checkLength }], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, -P, 0] }] }], shearDeformation: true });
      return r;
    };
    const flags = (r) => frameValidity(r, r.cases[0]).flags.map((f) => f.code);
    assert.ok(flags(mk(0.3)).includes("deep_member"), "L/d 1.5 flagged");
    assert.ok(!flags(mk(0.3, 0.6)).includes("deep_member"), "a segment of a 0.6 m member is judged on 0.6 m");
    assert.ok(!flags(mk(0.6)).includes("deep_member"));
  });
});

describe("Bredt closed-section torsion", () => {
  it("rect tube J = 4 Am² t / perimeter (mid-line), and a tube twists T L / G J", () => {
    const b = 0.09, h = 0.28, t = 0.004;
    const Am = (b - t) * (h - t), per = 2 * (b - t + h - t);
    const J = (4 * Am ** 2 * t) / per;
    near(sectionProps({ shape: "rect-tube", width: b, height: h, wall: t }).J, J, 1e-12, "Bredt J");
    const L = 1.5, T = 500;
    const r = analyzeFrame({ nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }], members: [{ id: "m", i: "a", j: "b", section: { shape: "rect-tube", width: b, height: h, wall: t }, E, G }], supports: [{ node: "a", fix: "fixed" }], loadCases: [{ id: "T", nodal: [{ node: "b", F: [0, 0, 0], M: [T, 0, 0] }] }], up: [0, 0, 1], shearDeformation: true });
    near(r.cases[0].nodeDisplacement("b")[3], (T * L) / (G * J), 1e-9, "twist");
    // Bredt shear stress q / t = T / (2 Am t)
    near(r.cases[0].members[0].worst.tau, T / (2 * Am * t), 1e-9, "shear stress");
  });
});

describe("shear panels (equivalent crossed diagonals)", () => {
  // edges axially rigid with no bending stiffness: the panel alone resists shear
  const edge = { shape: "properties", A: 1, Iz: 1e-14, Iy: 1e-14, J: 1e-14, Asy: 1, Asz: 1 };
  const panelFrame = (a, b, t) => {
    const nodes = [{ id: "1", x: 0, y: 0, z: 0 }, { id: "2", x: a, y: 0, z: 0 }, { id: "3", x: a, y: b, z: 0 }, { id: "4", x: 0, y: b, z: 0 }];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pd = panelDiagonals(byId, { id: "p", nodes: ["1", "2", "3", "4"] }, { E, G, t });
    const members = [["e12", "1", "2"], ["e23", "2", "3"], ["e34", "3", "4"], ["e41", "4", "1"]].map(([id, i, j]) => ({ id, i, j, section: edge, E: 1e13, G: 1e13 }))
      .concat(pd.diagonals.map((d) => ({ id: d.id, i: d.i, j: d.j, section: d.section, E, G, segments: 1 })));
    const keep = ["z", "rx", "ry", "rz"];
    const supports = [{ node: "1", fix: ["x", "y", ...keep] }, { node: "2", fix: ["x", "y", ...keep] }, { node: "3", fix: keep }, { node: "4", fix: keep }];
    return { nodes, members, supports, pd };
  };
  for (const [a, b] of [[0.8, 0.8], [1.2, 0.5], [0.5, 1.2]]) {
    it(`${a} × ${b} m panel: top-edge shear deflection = V b / (G t a), and τ recovered = V / (t a)`, () => {
      const t = 0.002, V = 2000;
      const f = panelFrame(a, b, t);
      const r = analyzeFrame({ nodes: f.nodes, members: f.members, supports: f.supports, loadCases: [{ id: "V", nodal: [{ node: "3", F: [V / 2, 0, 0] }, { node: "4", F: [V / 2, 0, 0] }] }], segments: 1 });
      assert.ok(r.ok, r.error);
      // 1e-5: the edges are axially stiff (E A = 1e13 N), not rigid
      near(r.cases[0].nodeDisplacement("3")[0], (V * b) / (G * t * a), 1e-5, "shear deflection");
      const N = (id) => r.cases[0].members.find((m) => m.id === id).worst.N;
      near(panelShear({ N1: N("p/d1"), N2: N("p/d2"), d1: f.pd.geometry.d1, d2: f.pd.geometry.d2, t }), V / (t * a), 1e-4, "panel shear stress");
    });
  }
  it("elastic shear buckling: k_s = 5.35 + 4 (b/a)², τcr = k_s π² E / (12 (1 − ν²)) (t/b)²", () => {
    const r = plateShearBuckling({ a: 1.0, b: 0.5, t: 0.002, E: 70e9, nu: 0.33 });
    near(r.ks, 5.35 + 4 * 0.25, 1e-12, "k_s");
    near(r.tauCr, (6.35 * Math.PI ** 2 * 70e9) / (12 * (1 - 0.33 ** 2)) * (0.002 / 0.5) ** 2, 1e-12, "τcr");
    assert.equal(plateShearBuckling({ a: 0.5, b: 1.0, t: 0.002, E: 70e9, nu: 0.33 }).ks, r.ks, "short side governs either way");
  });
  it("rect-tube wall local buckling: k 4.0 compression, 5.35 shear, Rc + Rs² (NACA TN 3781)", () => {
    const sec = sectionProps({ shape: "rect-tube", width: 0.09, height: 0.28, wall: 0.004 });
    const m = { sec, E: 68.9e9, G: 68.9e9 / 2.66, fy: 276e6 };
    const lb = plateLocalBuckling(m, { sigma: 20e6, tau: 10e6 });
    const nu = m.E / (2 * m.G) - 1, bw = 0.28 - 0.004;
    const base = (Math.PI ** 2 * m.E) / (12 * (1 - nu * nu)) * (0.004 / bw) ** 2;
    near(lb.sigmaCr, 4 * base, 1e-12, "σcr");
    near(lb.R, 20e6 / (4 * base) + (10e6 / (5.35 * base)) ** 2, 1e-12, "interaction");
    assert.equal(lb.inelastic, false);
    assert.equal(plateLocalBuckling(m, { sigma: 0.6 * 276e6, tau: 0 }).inelastic, true);
  });
});

describe("the car's structural tub", () => {
  const ladder = buildCarFromLibrary(BRIEF, { cadBody: false, chassis: "ladder" });
  const tub = buildCarFromLibrary(BRIEF, { cadBody: false });
  const s = openDesign(tub.ir).session;
  const s0 = openDesign(ladder.ir).session;
  const frame = s.result("structure.frame@CHASSIS");

  it("is a labelled design change that replaces the ladder rails and the notional TUB shell", () => {
    assert.ok(tub.tubChange && /structural tub/.test(tub.tubChange.new));
    assert.deepEqual(tub.tubChange.removed.map((r) => r.id).sort(), ["RAIL_L", "RAIL_R", "TUB"]);
    for (const id of ["RAIL_L", "RAIL_R", "TUB"]) assert.ok(!tub.ir.nodes.some((n) => n.id === id), id);
    assert.ok(/design change/.test(tub.configuration.sources.chassis));
    for (const [k, v] of Object.entries(TUB_DESIGN_CHOICES)) assert.ok(v.basis && v.basis.length > 10, `${k} has a basis`);
  });

  it("torsional stiffness meets the cited target (Lotus Elise bonded aluminium tub, 10,800 N·m/deg) with every check in range", () => {
    assert.equal(frame.status, "PASS", `${frame.reason || ""} ${(frame.warnings || []).join(" | ")} ${(frame.failures || []).join(" | ")}`);
    const k = frame.outputs["stiffness.torsional"];
    assert.ok(k.perDegree >= TORSION_TARGET.perDegree, `${k.perDegree}`);
    // pinned so a change to the tub or the solver shows up: 12,222 N·m/deg with the openings and their
    // repairs (brief 4 item 2; 10,992 before the openings were designed)
    near(k.perDegree, 12222, 0.01, "torsional stiffness N·m/deg");
    assert.ok(frame.margins.some((m) => /stiffness torsional ≥ target/.test(m.check)));
    assert.ok(TORSION_TARGET.sources.every((x) => x.url && x.quote));
    const ladderFrame = openDesign(withChassisFrame(ladder.ir)).session.result("structure.frame@CHASSIS");
    near(ladderFrame.outputs["stiffness.torsional"].perDegree, 8.30, 0.01, "the ladder screen it replaces");
  });

  it("the twist profile is monotonic from the front axle to the rear axle (where the compliance is)", () => {
    const p = frame.outputs["stiffness.torsional.profile"].value;
    assert.equal(p[0].station, "front-axle");
    near(Math.abs(p[0].fractionOfTotal), 1, 1e-9, "the front pickup carries the whole twist");
    for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i].fractionOfTotal) <= Math.abs(p[i - 1].fractionOfTotal) + 1e-9, p[i].station);
    assert.ok(Math.abs(p.at(-1).fractionOfTotal) < 1e-9, "rear axle held");
  });

  it("2 g bending and the kerb twist pass their stress, panel-buckling and wall-buckling checks", () => {
    const sum = frame.outputs["bending.reactionSum"].value[2];
    near(sum, s.result("mass.assembly@VEH").outputs.grossMass.value * 9.80665 * 2, 1e-9, "2 g reactions");
    const panels = frame.outputs["kerb-twist.panels"].value;
    for (const p of panels) assert.ok(p.tauPa < p.tauCrPa, `${p.id} ${p.tauPa} < ${p.tauCrPa}`);
    for (const m of frame.margins) assert.ok(m.utilization <= 1, `${m.check} ${m.utilization}`);
    assert.ok(Object.values(frame.outputs.validity.value).every((v) => v.flags.length === 0));
    assert.ok(Object.values(frame.outputs.validity.value).some((v) => v.checks.some((c) => c.code === "local_buckling_checked")), "slender walls were checked, not skipped");
  });

  it("costs mass and moves the CG, reported against the ladder screen", () => {
    const m1 = s.result("mass.assembly@VEH").outputs.mass.value, m0 = s0.result("mass.assembly@VEH").outputs.mass.value;
    const c1 = s.result("mass.assembly@CHASSIS").outputs.mass.value, c0 = s0.result("mass.assembly@CHASSIS").outputs.mass.value;
    near(m1 - m0, c1 - c0, 1e-9, "the whole difference is the chassis");
    assert.ok(c1 - c0 > 80 && c1 - c0 < 100, `${c1 - c0} kg added`);
    const g1 = s.result("mass.cg@VEH").outputs, g0 = s0.result("mass.cg@VEH").outputs;
    assert.ok(g1.cgZ.value > g0.cgZ.value, "the pillar ring raises the CG");
    assert.ok(Math.abs(g1.cgY.value) < 1e-9, "symmetric");
    assert.ok(s.result("requirement.check@REQ_mass").status === "PASS");
  });

  it("every part clears the packaging envelopes and the occupants' egress lines (separating-axis test)", () => {
    const b2 = buildCarFromLibrary(BRIEF, { chassis: "ladder" });
    const g = DesignGraph.fromIR(b2.ir).graph;
    const q = cadBodyRequest({ get: (id, p) => g.get(id, p) }, "BODY_SHELL");
    const veh = b2.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    const lay = tubLayout({ frontAxleX: parseFloat(veh.frontAxleX), rearAxleX: parseFloat(veh.rearAxleX) });
    const rows = tubPackagingFit(q.scene, lay.parts);
    for (const r of rows) assert.ok(r.minClearanceM >= 0.0025, `${r.part} ${r.minClearanceM} (${r.against})`);
    // the egress lines are real constraints: a box on the rear occupant's egress line is caught
    const probe = { id: "probe", geometry: { shape: "plate" }, box: { center: [3.481, 0.595, 0.6], half: [0.04, 0.04, 0.1] } };
    const hit = tubPackagingFit(q.scene, [probe])[0];
    assert.ok(hit.minClearanceM < 0 && /egress|SEAT_4/.test(hit.against), JSON.stringify(hit));
  });

  it("the tub is the default build; the ladder is kept on request and an unknown chassis is an error", () => {
    assert.ok(tub.ir.nodes.some((n) => n.id === "TUB_SILL_L") && !tub.ir.nodes.some((n) => n.id === "RAIL_L"));
    assert.ok(ladder.ir.nodes.some((n) => n.id === "RAIL_L"));
    assert.ok(buildCarFromLibrary(BRIEF, { cadBody: false, packaging: false }).ir.nodes.some((n) => n.id === "RAIL_L"), "no package to lay a tub in: the ladder screen");
    assert.ok(buildCarFromLibrary(BRIEF, { cadBody: false, chassis: "spaceframe" }).error);
  });
});

const HAVE_KERNEL = fs.existsSync(kernelPythonPath());
const BODY_STEP = process.env.CONKAY_TUB_BODY_STEP;
describe("tub inside the CAD body skin (OpenCascade)", { skip: !(HAVE_KERNEL && BODY_STEP) && "set CONKAY_TUB_BODY_STEP to the car body's STEP with a kernel available" }, () => {
  it("every boxed part is inside the skin with clearance to its inner face", async () => {
    const b = buildCarFromLibrary(BRIEF, { chassis: "ladder" });
    const t = withStructuralTub(b.ir);
    const r = await runTubFitKernelAsync({ step: BODY_STEP, skinThickness: 0.002925, boxes: t.layout.parts.filter((p) => !p.box.conformsToSkin).map(tubPartBox) });
    assert.equal(r.ok, true, r.error);
    for (const x of r.rows) assert.ok(x.fits, `${x.id} ${JSON.stringify(x)}`);
  });
  it("a box through the skin is reported outside", async () => {
    const r = await runTubFitKernelAsync({ step: BODY_STEP, skinThickness: 0.002925, boxes: [obb({ id: "out", center: [2.5, 0.95, 0.3], half: [0.1, 0.1, 0.1] })] });
    assert.equal(r.rows[0].fits, false);
  });
});
