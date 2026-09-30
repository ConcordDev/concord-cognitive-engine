// server/tests/fea-frame-element.test.js
//
// Closed-form checks for lib/simulation/fea-solver.js. Found by an Engineering
// lens QA run (2026-09-27): a symmetric portal frame gave lopsided reactions
// (8,222 / 11,778 lb instead of 10,000 / 10,000) because the old element added
// bending stiffness along GLOBAL Y for every in-plane member — wrong for
// columns (axial ~17% too stiff, zero lateral stiffness) and dependent on node
// order. Every expected value below is a textbook formula, not solver output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFEA } from "../lib/simulation/fea-solver.js";

const fix = (id) => ({ nodeId: id, type: "fixed", fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] });
const E = 29e6, A = 8.25, I = 82.8, L = 12, P = 10000;
const close = (got, expect, label) => assert.ok(Math.abs(got - expect) <= 1e-9 * Math.max(1, Math.abs(expect)) + 1e-15, `${label}: got ${got}, expected ${expect}`);
const disp = (r, id) => r.displacements.find((d) => d.nodeId === id);

function column(nodeI, nodeJ, load) {
  return runFEA({
    nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 0, y: L, z: 0 }],
    members: [{ id: "m", nodeI, nodeJ, area: A, momentI: I, elasticModulus: E }],
    loads: [{ nodeId: "b", ...load }], supports: [fix("a")],
  });
}
function beam(load) {
  return runFEA({
    nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }],
    members: [{ id: "m", nodeI: "a", nodeJ: "b", area: A, momentI: I, elasticModulus: E }],
    loads: [{ nodeId: "b", ...load }], supports: [fix("a")],
  });
}

test("column under axial load shortens by PL/AE, whichever end is listed first", () => {
  close(disp(column("a", "b", { Fy: -P }), "b").dy, -P * L / (A * E), "a->b");
  close(disp(column("b", "a", { Fy: -P }), "b").dy, -P * L / (A * E), "b->a");
});

test("column tip deflects PL³/3EI under a lateral load (was 0 before the fix)", () => {
  close(disp(column("a", "b", { Fx: P }), "b").dx, P * L ** 3 / (3 * E * I), "a->b");
  close(disp(column("b", "a", { Fx: P }), "b").dx, P * L ** 3 / (3 * E * I), "b->a");
});

test("beam: axial PL/AE, tip load PL³/3EI, tip moment rotation ML/EI", () => {
  close(disp(beam({ Fx: P }), "b").dx, P * L / (A * E), "axial");
  close(disp(beam({ Fy: -P }), "b").dy, -P * L ** 3 / (3 * E * I), "tip load");
  close(disp(beam({ Mz: 1000 }), "b").rz, 1000 * L / (E * I), "tip moment");
});

test("inclined (45°) member under axial load: δ = PL/AE along its axis", () => {
  const r = runFEA({
    nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L / Math.SQRT2, y: L / Math.SQRT2, z: 0 }],
    members: [{ id: "m", nodeI: "a", nodeJ: "b", area: A, momentI: I, elasticModulus: E }],
    loads: [{ nodeId: "b", Fx: P / Math.SQRT2, Fy: P / Math.SQRT2 }], supports: [fix("a")],
  });
  close(disp(r, "b").dx, (P * L / (A * E)) / Math.SQRT2, "dx");
  close(disp(r, "b").dy, (P * L / (A * E)) / Math.SQRT2, "dy");
});

test("symmetric portal frame gives symmetric results in both member orientations", () => {
  for (const [i, j] of [["N4", "N3"], ["N3", "N4"]]) {
    const r = runFEA({
      nodes: [{ id: "N1", x: 0, y: 0, z: 0 }, { id: "N2", x: 0, y: 12, z: 0 }, { id: "N3", x: 20, y: 12, z: 0 }, { id: "N4", x: 20, y: 0, z: 0 }],
      members: [
        { id: "M1", nodeI: "N1", nodeJ: "N2", area: 8.25, momentI: 82.8, elasticModulus: 29e6 },
        { id: "M2", nodeI: "N2", nodeJ: "N3", area: 11.8, momentI: 171, elasticModulus: 29e6 },
        { id: "M3", nodeI: i, nodeJ: j, area: 8.25, momentI: 82.8, elasticModulus: 29e6 },
      ],
      loads: [{ nodeId: "N2", Fy: -10000 }, { nodeId: "N3", Fy: -10000 }],
      supports: [fix("N1"), fix("N4")],
    });
    const Ry = (id) => r.reactions.find((x) => x.nodeId === id && x.dof === "y").force;
    close(Ry("N1"), 10000, `Ry N1 (${i}->${j})`);
    close(Ry("N4"), 10000, `Ry N4 (${i}->${j})`);
    close(disp(r, "N2").dy, -10000 * 12 / (8.25 * 29e6), "N2 dy = PL/AE");
    close(disp(r, "N3").dy, -10000 * 12 / (8.25 * 29e6), "N3 dy = PL/AE");
    close(r.memberForces[2].axialForce, -10000, "column axial force is compression, orientation-independent");
    assert.deepEqual(r.warnings, []);
  }
});

test("an unsupported structure is reported as unstable, not as zero displacement", () => {
  const r = runFEA({
    nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: L, y: 0, z: 0 }],
    members: [{ id: "m", nodeI: "a", nodeJ: "b" }],
    loads: [{ nodeId: "b", Fy: -1 }], supports: [],
  });
  assert.equal(r.warnings[0]?.code, "unstable_structure");
});
