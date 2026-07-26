/**
 * Pins the direct-stiffness support-reaction recovery in runFEA (previously a
 * dead loop that always reported no force). The oracle is statics, not pasted
 * solver output: a cantilever with a fixed base and a transverse tip load P
 * must develop a base shear reaction of −P and a base moment reaction of −P·L,
 * and the whole system must satisfy translational equilibrium
 * (Σ reactions + Σ applied loads ≈ 0).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runFEA } from "../lib/simulation/fea-solver.js";

describe("FEA support reactions", () => {
  // Horizontal cantilever along +x: node A fixed at origin, node B free at (L,0,0).
  const L = 120; // in
  const P = 1000; // lbf, applied transverse (+y) at the tip
  const model = {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", nodeI: "A", nodeJ: "B", elasticModulus: 29e6, area: 10, momentI: 100 },
    ],
    supports: [{ nodeId: "A", type: "fixed" }],
    loads: [{ nodeId: "B", Fy: P }],
  };

  const res = runFEA(model);

  it("solves and returns reactions carrying a force field", () => {
    assert.equal(res.ok, true);
    assert.ok(res.reactions.length > 0);
    for (const r of res.reactions) assert.equal(typeof r.force, "number");
  });

  it("base shear reaction ≈ −P (translational equilibrium in y)", () => {
    const fy = res.reactions.find((r) => r.nodeId === "A" && r.dof === "y");
    assert.ok(fy, "y reaction at A present");
    assert.ok(Math.abs(fy.force - -P) < 1e-3 * P, `Fy reaction ${fy.force} ≈ ${-P}`);
  });

  it("base moment reaction ≈ −P·L (moment equilibrium about the base)", () => {
    const mz = res.reactions.find((r) => r.nodeId === "A" && r.dof === "rz");
    assert.ok(mz, "rz reaction at A present");
    const expected = -P * L;
    assert.ok(Math.abs(mz.force - expected) < 1e-3 * Math.abs(expected),
      `Mz reaction ${mz.force} ≈ ${expected}`);
  });

  it("global equilibrium: Σ y-reactions + Σ applied Fy ≈ 0", () => {
    const sumReactY = res.reactions
      .filter((r) => r.dof === "y")
      .reduce((s, r) => s + r.force, 0);
    const sumAppliedY = model.loads.reduce((s, l) => s + (l.Fy || 0), 0);
    assert.ok(Math.abs(sumReactY + sumAppliedY) < 1e-3 * P,
      `equilibrium residual ${sumReactY + sumAppliedY}`);
  });
});
