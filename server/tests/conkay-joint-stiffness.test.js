// server/tests/conkay-joint-stiffness.test.js
//
// Joint springs, the Bredt closed-cell cross-check, and the section-cut torque.
// Closed forms:
//   cantilever with a rotational spring at the root,
//     delta = P L³ / 3 E I + P L² / k
//     (beam and spring flexibilities in series; the rigid limit is the
//     Timoshenko/Euler cantilever already in conkay-car-tub.test.js);
//   Bredt-Batho J = 4 Am² / ∮(ds/t), and a four-panel rectangular tube twists
//     by T L / G J (Megson, Aircraft Structures, ch. 18);
//   Saint-Venant path of one prismatic tube = G J / L.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFrame, sectionProps } from "../lib/conkay/structural/frame-fe.js";
import { panelDiagonals } from "../lib/conkay/structural/shear-panel.js";
import { bondSleeveSprings, distortionSprings, jointSchedule, JOINT_TYPES, scenarioSprings } from "../lib/conkay/structural/joint-stiffness.js";
import { rectangularCellJ, saintVenantStiffness, sectionCutTorque, crossCheckReading, specificStiffness, eliseSpecific } from "../lib/conkay/structural/tub-torsion-check.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-15, `${msg}: ${a} vs ${b}`);
const E = 70e9, G = 26e9;

describe("semi-rigid end spring", () => {
  it("cantilever tip deflection is P L³/3EI + P L²/k, and the unsprung beam stays P L³/3EI", () => {
    const sec = { shape: "rect", width: 0.04, height: 0.08 };
    const Iz = sectionProps(sec).Iz;
    const L = 1.2, P = 1000, k = 5e4;
    const beam = (P * L ** 3) / (3 * E * Iz);
    const sprung = analyzeFrame({
      nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }],
      members: [{ id: "m", i: "a", j: "b", section: sec, E, G, endSprings: { i: [1e12, 1e12, k] } }],
      supports: [{ node: "a", fix: "fixed" }],
      loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, 0, -P] }] }],
      up: [0, 0, 1],
    });
    assert.equal(sprung.ok, true, sprung.error);
    near(-sprung.cases[0].nodeDisplacement("b")[2], beam + (P * L * L) / k, 1e-6, "spring in series");
    const rigid = analyzeFrame({
      nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }],
      members: [{ id: "m", i: "a", j: "b", section: sec, E, G }],
      supports: [{ node: "a", fix: "fixed" }],
      loadCases: [{ id: "P", nodal: [{ node: "b", F: [0, 0, -P] }] }],
      up: [0, 0, 1],
    });
    near(-rigid.cases[0].nodeDisplacement("b")[2], beam, 1e-9, "no spring");
  });
});

describe("bond-line and classification springs", () => {
  it("sleeve bending stiffness matches the face integral, and EN 1993 springs are kappa E I / L", () => {
    const b = 0.09, h = 0.28, Ga = 3.6e8, ta = 5e-4, overlap = 0.05;
    const c = (Ga * overlap) / ta;
    const k = bondSleeveSprings({ width: b, height: h }, { Ga, ta, overlap });
    near(k[2], c * ((b * h * h) / 2 + (h ** 3) / 6), 1e-12, "bend about local z");
    near(k[1], c * ((h * b * b) / 2 + (b ** 3) / 6), 1e-12, "bend about local y");
    near(k[0], c * (b * h * (b + h)) / 2, 1e-12, "torsion, constant slip on each face");
    const sec = sectionProps({ shape: "rect-tube", width: b, height: h, wall: 0.004 });
    const L = 1.4, kappa = 8;
    const d = distortionSprings({ E, G, sec, L }, kappa);
    near(d[0], kappa * G * sec.J / L, 1e-12, "torsion boundary");
    near(d[1], kappa * E * sec.Iy / L, 1e-12, "Iy boundary");
    near(d[2], kappa * E * sec.Iz / L, 1e-12, "Iz boundary");
  });

  it("every tub joint is bonded and riveted, and none is welded", () => {
    const members = [
      { id: "sill-a", i: "n1", j: "n2", part: "SILL" },
      { id: "post-a", i: "n2", j: "n3", part: "POST" },
    ];
    const rows = jointSchedule(members, { panels: [{ id: "floor", part: "FLOOR" }] });
    assert.equal(rows.length, 3, "two extrusion ends at the shared node, plus the sheet");
    for (const r of rows) {
      assert.equal(r.type, "bonded+riveted");
      assert.equal(r.weld, false);
      assert.equal(JOINT_TYPES[r.jointClass].weld, false);
    }
    assert.equal(rows.filter((r) => r.jointClass === "sheet-flange").length, 1);
  });

  it("a part that runs through a node is not a joint; a free end is not either", () => {
    const members = [
      { id: "a", i: "n1", j: "n2", part: "RAIL", section: { shape: "rect", width: 0.05, height: 0.1 }, E, G, L: 1 },
      { id: "b", i: "n2", j: "n3", part: "RAIL", section: { shape: "rect", width: 0.05, height: 0.1 }, E, G, L: 1 },
    ];
    assert.equal(scenarioSprings(members, { bond: { Ga: 1e8, ta: 2e-4, overlap: 0.05 }, kappa: null }).rows.length, 0);
  });
});

describe("Bredt closed cell, not the shear-panel formula", () => {
  it("rectangular cell J matches the rect-tube midline formula", () => {
    const b = 0.086, h = 0.276, t = 0.004;
    near(rectangularCellJ(b, h, t), sectionProps({ shape: "rect-tube", width: b + t, height: h + t, wall: t }).J, 1e-9, "midline cell");
  });

  it("a tube of four shear panels twists by T L / G J", () => {
    const a = 0.4, L = 1.5, t = 0.002, T = 400;
    const nodes = [
      { id: "a0", x: 0, y: 0, z: 0 }, { id: "a1", x: 0, y: a, z: 0 }, { id: "a2", x: 0, y: a, z: a }, { id: "a3", x: 0, y: 0, z: a },
      { id: "b0", x: L, y: 0, z: 0 }, { id: "b1", x: L, y: a, z: 0 }, { id: "b2", x: L, y: a, z: a }, { id: "b3", x: L, y: 0, z: a },
    ];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edge = { shape: "properties", A: 1e-2, Iz: 1e-10, Iy: 1e-10, J: 1e-12, Asy: 1e-2, Asz: 1e-2, depth: 0.01 };
    const edges = [["e0", "a0", "b0"], ["e1", "a1", "b1"], ["e2", "a2", "b2"], ["e3", "a3", "b3"]]
      .map(([id, i, j]) => ({ id, i, j, section: edge, E: 1e13, G: 1e13, segments: 1 }));
    const walls = [
      ["bottom", ["a0", "b0", "b1", "a1"]],
      ["top", ["a3", "b3", "b2", "a2"]],
      ["side0", ["a0", "b0", "b3", "a3"]],
      ["side1", ["a1", "b1", "b2", "a2"]],
    ];
    const diags = walls.flatMap(([id, ns]) => panelDiagonals(byId, { id, nodes: ns }, { E, G, t }).diagonals
      .map((d) => ({ id: d.id, i: d.i, j: d.j, section: d.section, E, G, segments: 1 })));
    // The torque has to be delivered through a stiff diaphragm at the loaded end. A diaphragm
    // only between the already-fixed root nodes does nothing, and without one at the loaded
    // end the torque is a couple of two web shears: the twist is 2× Bredt and the top and
    // bottom diagonals carry nothing. Megson's closed cell assumes the end can keep that flow.
    const dia = { shape: "properties", A: 1e-2, Iz: 1e-4, Iy: 1e-4, J: 1e-4, Asy: 1e-2, Asz: 1e-2, depth: 0.05 };
    const bulkhead = [
      ["d01", "b0", "b1"], ["d12", "b1", "b2"], ["d23", "b2", "b3"], ["d30", "b3", "b0"],
      ["dx1", "b0", "b2"], ["dx2", "b1", "b3"],
    ].map(([id, i, j]) => ({ id, i, j, section: dia, E: 1e13, G: 1e13, segments: 1 }));
    // couple T about x at the free end: F * a = T, split onto the two nodes of each vertical edge
    const F = T / a;
    const r = analyzeFrame({
      nodes, members: [...edges, ...diags, ...bulkhead],
      supports: ["a0", "a1", "a2", "a3"].map((n) => ({ node: n, fix: "fixed" })),
      loadCases: [{ id: "T", nodal: [{ node: "b0", F: [0, 0, -F / 2] }, { node: "b3", F: [0, 0, -F / 2] }, { node: "b1", F: [0, 0, F / 2] }, { node: "b2", F: [0, 0, F / 2] }] }],
      up: [0, 0, 1], segments: 1,
    });
    assert.equal(r.ok, true, `${r.error} ${r.detail}`);
    const J = rectangularCellJ(a, a, t);
    const uz0 = (r.cases[0].nodeDisplacement("b0")[2] + r.cases[0].nodeDisplacement("b3")[2]) / 2;
    const uz1 = (r.cases[0].nodeDisplacement("b1")[2] + r.cases[0].nodeDisplacement("b2")[2]) / 2;
    const theta = (uz1 - uz0) / a;
    // loaded-end diaphragm: this mesh matches Bredt to about 0.1 %
    near(theta, (T * L) / (G * J), 0.01, "four-panel tube vs Bredt");
    const axial = diags.map((d) => Math.abs(r.cases[0].members.find((m) => m.id === d.id).worst.N));
    const lo = Math.min(...axial), hi = Math.max(...axial);
    assert.ok(lo > 0.5 * hi, `all four walls carry the shear flow: ${lo} vs ${hi}`);
  });

  it("the Saint-Venant path of one tube is G J / L, and a gap is not a finite stiffness", () => {
    const sec = { shape: "rect-tube", width: 0.09, height: 0.28, wall: 0.004 };
    const J = sectionProps(sec).J;
    const L = 2.2;
    const nodes = [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }];
    const sv = saintVenantStiffness({ nodes, members: [{ id: "m", i: "a", j: "b", section: sec, G }], x0: 0, x1: L });
    assert.equal(sv.finite, true);
    near(sv.value, (G * J) / L, 1e-6, "prismatic tube");
    const gap = saintVenantStiffness({
      nodes: [...nodes, { id: "c", x: L + 0.5, y: 0, z: 0 }, { id: "d", x: L + 2, y: 0, z: 0 }],
      members: [{ id: "m", i: "a", j: "b", section: sec, G }, { id: "n", i: "c", j: "d", section: sec, G }],
      x0: 0, x1: L + 2,
    });
    assert.equal(gap.finite, false);
    assert.ok(gap.gapAt > L && gap.gapAt < L + 0.5);
  });
});

describe("section-cut torque", () => {
  it("a prismatic tube carries the whole end moment across a mid cut", () => {
    const sec = { shape: "rect-tube", width: 0.09, height: 0.28, wall: 0.004 };
    const L = 2, T = 500;
    const nodes = [{ id: "a", x: 0, y: 0.2, z: 0.3 }, { id: "b", x: L, y: 0.2, z: 0.3 }];
    const members = [{ id: "sill-1", i: "a", j: "b", section: sec, E, G }];
    const r = analyzeFrame({
      nodes, members,
      supports: [{ node: "a", fix: "fixed" }],
      loadCases: [{ id: "T", nodal: [{ node: "b", M: [T, 0, 0] }] }],
      up: [0, 0, 1],
    });
    assert.equal(r.ok, true, r.error);
    const cut = sectionCutTorque({ nodes, members, memberResults: r.cases[0].members, xCut: L / 2, axis: { y: 0.2, z: 0.3 } });
    near(cut.totalNm, T, 1e-6, "cut torque");
    near(cut.groups["closed-tube"].share, 1, 1e-9, "the tube is the whole path");
  });

  it("a two-rail couple's cut equals the moment of the forces on the high-x side", () => {
    const sec = { shape: "rect-tube", width: 0.08, height: 0.08, wall: 0.004 };
    const nodes = [
      { id: "aL", x: 0, y: 0.4, z: 0 }, { id: "bL", x: 2, y: 0.4, z: 0 },
      { id: "aR", x: 0, y: -0.4, z: 0 }, { id: "bR", x: 2, y: -0.4, z: 0 },
    ];
    const members = [
      { id: "rail-L", i: "aL", j: "bL", section: sec, E, G },
      { id: "rail-R", i: "aR", j: "bR", section: sec, E, G },
      { id: "x0", i: "aL", j: "aR", section: sec, E, G },
      { id: "x2", i: "bL", j: "bR", section: sec, E, G },
    ];
    const r = analyzeFrame({
      nodes, members,
      supports: [{ node: "aL", fix: "fixed" }, { node: "aR", fix: ["x", "z"] }, { node: "bL", fix: ["z"] }],
      loadCases: [{ id: "T", nodal: [{ node: "bR", F: [0, 0, 10] }] }],
      up: [0, 0, 1],
    }, { segments: 4 });
    assert.equal(r.ok, true, r.error);
    const xCut = 1;
    const cut = sectionCutTorque({ nodes, members, memberResults: r.cases[0].members, xCut, axis: { y: 0, z: 0 } });
    const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
    let high = pos.bR.y * 10;
    for (const rec of r.cases[0].reactions) {
      const p = pos[rec.node];
      if (!(p.x > xCut)) continue;
      if (rec.dof === "z") high += p.y * rec.value;
      if (rec.dof === "y") high -= p.z * rec.value;
      if (rec.dof === "rx") high += rec.value;
    }
    near(cut.totalNm, high, 1e-6, "cut vs high-x external moment");
    assert.equal(cut.rows.length, 2);
    const reversed = members.map((m) => (m.id.startsWith("rail") ? { ...m, i: m.j, j: m.i } : m));
    const rr = analyzeFrame({
      nodes, members: reversed,
      supports: [{ node: "aL", fix: "fixed" }, { node: "aR", fix: ["x", "z"] }, { node: "bL", fix: ["z"] }],
      loadCases: [{ id: "T", nodal: [{ node: "bR", F: [0, 0, 10] }] }],
      up: [0, 0, 1],
    }, { segments: 4 });
    assert.equal(rr.ok, true, rr.error);
    const cutR = sectionCutTorque({ nodes, members: reversed, memberResults: rr.cases[0].members, xCut, axis: { y: 0, z: 0 } });
    near(cutR.totalNm, high, 1e-4, "reversed rails, same face");
  });
});

describe("cross-check reading", () => {
  it("says what the three stiffnesses are, and does not invent a fourth", () => {
    const frame = crossCheckReading({ withPanels: 12000, withoutPanels: 10000, saintVenant: 8000 });
    assert.ok(frame.panelFraction < 0.25 && /not an artifact/.test(frame.reading));
    const panels = crossCheckReading({ withPanels: 12000, withoutPanels: 4000, saintVenant: 3000 });
    assert.ok(panels.panelFraction > 0.5 && panels.frameOverSaintVenant < 1.5 && /mostly the equivalent-diagonal/.test(panels.reading));
    const mixed = crossCheckReading({ withPanels: 12000, withoutPanels: 5000, saintVenant: 2000 });
    assert.ok(/mixed/.test(mixed.reading));
  });
});

describe("Elise specific stiffness", () => {
  it("uses both published stiffnesses over the cited 68 kg and 876 kg, and does not average them", () => {
    const rows = eliseSpecific();
    assert.deepEqual(rows.map((r) => r.stiffnessPerDegree), [10800, 9800]);
    near(rows[0].perKgTub, 10800 / 68, 1e-12, "press pack per kg of tub");
    near(rows[1].perKgTub, 9800 / 68, 1e-12, "brochure per kg of tub");
    near(rows[0].perKgVehicle, 10800 / 876, 1e-12, "press pack per kg of car");
    near(specificStiffness(12000, 80), 150, 1e-12, "caller mass");
    for (const r of rows) assert.ok(r.source.sha256 && r.source.quote);
  });
});
