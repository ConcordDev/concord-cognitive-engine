// server/tests/fea-stress-section-consistency.test.js
//
// FIX-engineering-010: bending stress recovery must use an extreme-fiber
// distance c consistent with the section's stated moment of inertia.
// The old fallback c = sqrt(A)/2 assumed a solid square; for the audit
// section (A = 8.25 in², I = 82.8 in⁴ — a square of that area has
// I = 5.67 in⁴) it reported 3,070 psi / 14.2% where the inertia-consistent
// c gives ~11,731 psi / ~54%. Expected values are closed-form Mc/I with
// c = sqrt(3I/A) (the rectangular identity I = A·d²/12), not solver output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFEA, computeStresses, checkUtilization } from "../lib/simulation/fea-solver.js";

const A = 8.25, I = 82.8, M = 177016; // audit case: P = 2248.09 lb at 78.74 in
const cRect = Math.sqrt(3 * I / A);

test("audit section: bending stress uses the inertia-consistent c", () => {
  const [s] = computeStresses(
    [{ id: "m", axialForce: 0, maxMoment: M }],
    [{ id: "m", area: A, momentI: I }],
  );
  assert.ok(Math.abs(s.cIn - cRect) < 1e-9, `c: got ${s.cIn}, expected ${cRect}`);
  const expected = (M * cRect) / I;
  assert.ok(Math.abs(s.bendingStress - expected) < 1e-6, `stress: got ${s.bendingStress}, expected ${expected}`);
  assert.ok(s.bendingStress > 11000 && s.bendingStress < 12500, `stress in the honest band, got ${s.bendingStress}`);
  const [u] = checkUtilization([s], [{ id: "m", area: A, momentI: I }]);
  assert.ok(Math.abs(u.utilization - expected / 21600) < 1e-6, `utilization: got ${u.utilization}`);
  assert.ok(u.utilization > 0.5, "no longer the unconservative 14.2%");
});

test("a true square section is unchanged (identity reduces to sqrt(A)/2)", () => {
  const Isq = (A * A) / 12;
  const [s] = computeStresses(
    [{ id: "m", axialForce: 0, maxMoment: M }],
    [{ id: "m", area: A, momentI: Isq }],
  );
  assert.ok(Math.abs(s.cIn - Math.sqrt(A) / 2) < 1e-9, `square c: got ${s.cIn}`);
  assert.ok(Math.abs(s.bendingStress - (M * (Math.sqrt(A) / 2)) / Isq) < 1e-6);
});

test("an explicit member depth still governs over the identity", () => {
  const [s] = computeStresses(
    [{ id: "m", axialForce: 0, maxMoment: M }],
    [{ id: "m", area: A, momentI: I, depthIn: 8.06 }],
  );
  assert.equal(s.cIn, 4.03);
  assert.equal(s.cBasis, "member depth");
  assert.ok(Math.abs(s.bendingStress - (M * 4.03) / I) < 1e-6);
});

test("end-to-end: the audit cantilever reports the honest stress", () => {
  const r = runFEA({
    nodes: [{ id: "fa", x: 0, y: 0, z: 0 }, { id: "fb", x: 78.74, y: 0, z: 0 }],
    members: [{ id: "m", nodeI: "fa", nodeJ: "fb", area: A, momentI: I, elasticModulus: 29e6 }],
    loads: [{ nodeId: "fb", Fy: -2248.09 }],
    supports: [{ nodeId: "fa", type: "fixed", fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }],
  });
  assert.equal(r.ok, true);
  const s = r.stresses[0];
  const expected = (M * cRect) / I;
  assert.ok(Math.abs(s.bendingStress - expected) / expected < 0.01, `e2e stress: got ${s.bendingStress}, expected ~${expected}`);
  // Deflection was already right and stays right: PL^3/3EI = 0.1524 in.
  const tip = r.displacements.find((d) => d.nodeId === "fb");
  assert.ok(Math.abs(Math.abs(tip.dy) - 0.1524) < 0.001, `tip deflection: got ${tip.dy}`);
});
