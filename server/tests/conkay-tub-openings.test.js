// server/tests/conkay-tub-openings.test.js
//
// Brief 4 item 2: the tub is the car's default chassis, and its openings are
// designed. Benchmarks first (each a closed form with its source), then the car.
//
// Membrane FE (structural/membrane-fe.js):
//   - patch tests: a solid sheet in picture-frame shear gives k = G t a / b, in
//     tension k = E t b / a (tau = G gamma, sigma = E eps), to round-off;
//   - plane-stress cantilever, L/h = 10, tip shear: Timoshenko beam
//     P L³/3EI + P L/(kappa G A), kappa = 5/6 (Timoshenko & Gere, Mechanics of
//     Materials), within 1 %;
//   - a circular hole in a wide sheet in tension: the compliance increase
//     converges (mesh) towards the non-interacting value 3p, E_eff = E/(1 + 3p)
//     (Kachanov, Tsukrov & Shafiro 1994, Appl. Mech. Rev. 47(1S):S151); the
//     finite sheet (hole diameter 10 % of the width) sits a few % above it.
// Open channel section (frame-fe.js u-channel): J = sum(l t³ / 3), section
// areas and centroid by hand.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sheetStiffness, membraneMesh, solveMembrane, cutoutShearFactor } from "../lib/conkay/structural/membrane-fe.js";
import { sectionProps, plateLocalBuckling } from "../lib/conkay/structural/frame-fe.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { withStructuralTub, TUB_DESIGN_CHOICES, TORSION_TARGET } from "../lib/conkay/structural/car-tub.js";
import { closedReference, checkOpenings, OPENING_CHOICES } from "../lib/conkay/structural/car-openings.js";
import { DesignGraph } from "../lib/conkay/graph/design-graph.js";
import { cadBodyRequest } from "../lib/conkay/physics/solvers/cad-body.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
const E = 68.9e9, nu = 0.33, t = 0.002;
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

describe("membrane FE benchmarks", () => {
  it("patch tests: solid sheet shear G t a / b and tension E t b / a", () => {
    near(sheetStiffness({ a: 0.7, b: 0.39, t, E, nu, cell: 0.05 }).ratio, 1, 1e-12, "shear");
    near(sheetStiffness({ a: 0.7, b: 0.39, t, E, nu, cell: 0.05, load: "tension" }).ratio, 1, 1e-12, "tension");
  });
  it("plane-stress cantilever: tip deflection within 1 % of Timoshenko beam theory", () => {
    const L = 1, h = 0.1, P = 1000, nx = 40, ny = 4;
    const mesh = membraneMesh({ a: L, b: h, nx, ny });
    const forces = [];
    for (let j = 0; j <= ny; j++) forces.push({ i: nx, j, fy: (P / ny) * (j === 0 || j === ny ? 0.5 : 1) });
    const r = solveMembrane(mesh, { t, E, nu, forces, prescribed: (i) => (i === 0 ? { u: 0, v: 0 } : null) });
    const I = (t * h ** 3) / 12, G = E / (2 * (1 + nu));
    near(r.disp(nx, ny / 2)[1], (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * G * t * h), 0.01, "tip");
  });
  it("circular hole: compliance increase converges toward the dilute 3p (finite sheet a few % above)", () => {
    const a = 0.05, p = Math.PI * a * a;
    const run = (cell) => 1 / sheetStiffness({ a: 1, b: 1, t, E, nu, cell, load: "tension", holes: [{ shape: "circle", cx: 0.5, cy: 0.5, r: a }] }).ratio - 1;
    const c60 = run(1 / 60), c120 = run(1 / 120);
    assert.ok(Math.abs(c120 / (3 * p) - 1) < Math.abs(c60 / (3 * p) - 1), "converging");
    assert.ok(c120 / (3 * p) > 1 && c120 / (3 * p) < 1.08, `${c120 / (3 * p)} × 3p`);
  });
  it("a cut-out lowers a sheet's shear stiffness; the 20, 10 and 5 mm meshes agree within 0.003", () => {
    const holes = [{ shape: "circle", cx: 0.35, cy: 0.2, r: 0.04 }];
    const f = cutoutShearFactor({ a: 0.705, b: 0.39, t, E, nu, holes, cell: 0.02 });
    assert.ok(f.value < 1 && f.value > 0.9, `${f.value}`);
    assert.ok(f.meshChange < 0.005, `${f.meshChange}`);
    const f5 = sheetStiffness({ a: 0.705, b: 0.39, t, E, nu, holes, cell: 0.005 }).ratio;
    assert.ok(Math.abs(f5 - f.value) < 0.003, `5 mm ${f5} vs 10 mm ${f.value}`);
  });
  it("refuses a hole that is not inside the sheet", () => {
    assert.throws(() => sheetStiffness({ a: 0.5, b: 0.3, t, E, nu, holes: [{ shape: "circle", cx: 0.02, cy: 0.1, r: 0.05 }] }), /not inside/);
  });
});

describe("open channel section (a cut-out in a closed cell)", () => {
  it("unlipped: areas, centroid and J = sum(l t³/3) by hand", () => {
    const b = 0.31, h = 0.51, w = 0.002;
    const s = sectionProps({ shape: "u-channel", width: b, height: h, wall: w });
    near(s.A, b * w + 2 * w * (h - 2 * w), 1e-12, "A");
    near(s.J, ((b - w) * w ** 3 + 2 * (h - w) * w ** 3) / 3, 1e-12, "J");
    const closed = sectionProps({ shape: "rect-tube", width: b, height: h, wall: w });
    assert.ok(s.J < closed.J / 1000, "an open cell keeps a tiny fraction of the closed cell's torsion constant");
    assert.equal(s.walls.plates[0].kc, 0.425, "free top edge");
  });
  it("lipped: the lips add area and J, support the side walls and are checked with a free edge", () => {
    const s = sectionProps({ shape: "u-channel", width: 0.31, height: 0.51, wall: 0.002, lip: 0.105 });
    const u = sectionProps({ shape: "u-channel", width: 0.31, height: 0.51, wall: 0.002 });
    near(s.A - u.A, 2 * 0.105 * 0.002, 1e-12, "lip area");
    near(s.J - u.J, (2 * 0.105 * 0.002 ** 3) / 3, 1e-9, "lip J");
    assert.deepEqual(s.walls.plates.map((p) => [p.id, p.kc]), [["side wall", 4.0], ["lip", 0.425], ["bottom", 4.0]]);
    // the 508 mm side wall (both edges supported) governs over the 104 mm free-edged lip:
    // 4.0 / 0.508² < 0.425 / 0.104²; without lips the free-edged side wall is ~9.4 times weaker
    const G = E / (2 * (1 + nu));
    const lb = plateLocalBuckling({ E, G, sec: s }, { sigma: 1e6, tau: 0 });
    assert.equal(lb.plate, "side wall");
    const lu = plateLocalBuckling({ E, G, sec: u }, { sigma: 1e6, tau: 0 });
    near(lb.sigmaCr / lu.sigmaCr, 4.0 / 0.425, 1e-9, "edge support by the lip (same 508 mm wall)");
  });
});

describe("the car's openings and the tub as the default", () => {
  const lad = buildCarFromLibrary(BRIEF, { cadBody: false, chassis: "ladder" });
  // brief 3's sections (before this item's repairs)
  const brief3Choices = {
    roofSection: { value: { ...TUB_DESIGN_CHOICES.roofSection.value, width: 0.07 }, basis: "brief 3" },
    postSection: { value: { ...TUB_DESIGN_CHOICES.postSection.value, height: 0.05 }, basis: "brief 3" },
    firewallPostWall: { value: 0.003, basis: "brief 3" },
  };
  const brief3 = withStructuralTub(lad.ir, { openings: false, choices: brief3Choices });
  const tubNow = buildCarFromLibrary(BRIEF, { cadBody: false });
  const kOf = (ir) => openDesign(ir).session.result("structure.frame@CHASSIS");
  const frame = kOf(tubNow.ir);
  const chassis = tubNow.ir.nodes.find((n) => n.id === "CHASSIS");
  const openings = chassis.props.tubOpenings;

  it("the default build is the tub, with its openings recorded", () => {
    assert.ok(tubNow.tubChange);
    assert.ok(openings && openings.doors.length === 4 && openings.glazing.length === 6);
    for (const v of Object.values(OPENING_CHOICES)) assert.ok(v.basis.length > 20);
  });

  it("the service cut-outs are cut in: firewall sheets scaled by their membrane factor, the gearbox cell open over the lever", () => {
    const fm = chassis.props.frameModel;
    const fwR = fm.panels.find((p) => p.id === "firewall-R"), fwL = fm.panels.find((p) => p.id === "firewall-L");
    assert.ok(fwR.shearStiffnessFactor.value < fwL.shearStiffnessFactor.value && fwL.shearStiffnessFactor.value < 1, "four pass-throughs on the driver's side, one on the other");
    near(fwR.shearStiffnessFactor.value, 0.887, 0.01, "driver-side firewall factor");
    const open = fm.members.find((m) => m.id === "tunnel-f1-open");
    assert.equal(open.section.shape, "u-channel");
    near(open.section.lip, 0.105, 1e-9, "lips either side of the 100 mm opening");
  });

  it("stiffness: what the openings cost, what the repairs bought, against the cited target", () => {
    const f3 = kOf(brief3.ir);
    const k3 = f3.outputs["stiffness.torsional"].perDegree;
    near(k3, 10992, 0.01, "brief 3 tub (openings not designed)");
    const cc3 = f3.outputs["stiffness.torsional.crossCheck"].value;
    assert.ok(Number.isFinite(cc3.withoutPanelsPerDegree) && Number.isFinite(cc3.saintVenantPerDegree) && cc3.reading, JSON.stringify(cc3));
    // rigid 10,992 is the upper bound. The computed bond line on these sections is under the target, so this geometry fails that one margin. The cross-check is mixed, not a panel-only artifact.
    assert.equal(f3.status, "FAIL");
    const jr3 = f3.outputs["stiffness.torsional.jointRange"].value;
    assert.ok(jr3.rigidPerDegree > TORSION_TARGET.perDegree && jr3.lowComputedPerDegree < TORSION_TARGET.perDegree, JSON.stringify(jr3));
    const over3 = (f3.margins || []).filter((m) => m.demand / m.capacity > 1);
    assert.equal(over3.length, 1);
    assert.match(over3[0].check, /lowest computed joint scenario/);
    near(cc3.withoutPanelsPerDegree, 8157, 0.01, "brief 3 with the shear panels removed");
    near(cc3.saintVenantPerDegree, 4207, 0.01, "brief 3 Saint-Venant of the closed extrusions");
    assert.ok(cc3.reading.startsWith("mixed"), cc3.reading);
    // the openings on the brief 3 sections (no repairs)
    const cut = withStructuralTub(lad.ir, { choices: brief3Choices });
    const kCut = kOf(cut.ir).outputs["stiffness.torsional"].perDegree;
    assert.ok(kCut < k3 && kCut > TORSION_TARGET.perDegree, `${kCut}`);
    near(kCut, 10820, 0.01, "openings cut, before the repairs (0.2 % over the target)");
    // a closed shell (every door and glazing opening panelled): the cost of the apertures
    const closedIr = JSON.parse(JSON.stringify(cut.ir));
    const ch = closedIr.nodes.find((n) => n.id === "CHASSIS");
    ch.props.frameModel = closedReference(ch.props.frameModel, cut.layout);
    const kClosed = kOf(closedIr).outputs["stiffness.torsional"].perDegree;
    assert.ok(kClosed > 1.7 * kCut, `closed ${kClosed} vs open ${kCut}`);
    // the repaired design
    assert.equal(frame.status, "WARN", `${frame.reason || ""} ${(frame.warnings || []).join(" | ")}`);
    assert.ok((frame.warnings || []).some((w) => /estimated joint-wall bound/.test(w)));
    const k = frame.outputs["stiffness.torsional"].perDegree;
    near(k, 12222, 0.01, "repaired tub with openings");
    assert.ok(k / TORSION_TARGET.perDegree > 1.1);
  });

  it("the openings clear the structure; egress lines pass through the door apertures", () => {
    const g = DesignGraph.fromIR(buildCarFromLibrary(BRIEF).ir).graph;
    const q = cadBodyRequest({ get: (id, p) => g.get(id, p) }, "BODY_SHELL");
    const oc = checkOpenings(openings, chassis.props.frameModel, q.scene.scenarios);
    assert.deepEqual(oc.failures, []);
    const egress = oc.rows.filter((r) => r.seat);
    assert.equal(egress.length, 12, "4 seats × 3 occupants");
    for (const r of egress) assert.ok(Math.min(r.foreClearanceM, r.aftClearanceM) > 0.1, JSON.stringify(r));
    // the rear doors are short at the sill (B-post to the wheel arch): measured, reported
    const rear = openings.doors.find((d) => d.id === "door-rear-L");
    assert.ok(rear.lengthAtSillM < 0.3, `${rear.lengthAtSillM}`);
    // the tall occupants must duck (a warning, not a pass)
    assert.ok(oc.warnings.some((w) => /M95.*duck/.test(w)));
    // a sheet in the windscreen is caught
    const bad = JSON.parse(JSON.stringify(chassis.props.frameModel));
    bad.panels.push({ id: "bad", nodes: ["FWA.L", "FWA.R", "RR0.R", "RR0.L"], part: "TUB_FLOOR_L" });
    assert.ok(checkOpenings(openings, bad, q.scene.scenarios).failures.some((f) => /windscreen/.test(f)));
  });
});
