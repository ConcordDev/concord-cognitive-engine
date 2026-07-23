/**
 * Program C, Stage 4 — FEA-based structural validation gate.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: every expected numeric
 * value here comes from actually calling the real engines
 * (momentOfInertia, bendingStress, runFEA) — never a pasted/hand-derived
 * number — so the tests fail if the engine's own math ever drifts, not just
 * if fea-gate.js's wiring breaks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { momentOfInertia, bendingStress } from "../lib/compute/physics-compute.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { generateSwordMesh } from "../lib/asset-gen/parametric-mesh.js";
import {
  structuralCheck,
  optimizeToPass,
  correctedMomentOfInertia,
  DEFAULT_SAFETY_FACTOR,
} from "../lib/asset-gen/fea-gate.js";

describe("physics-compute.js — rhombus/diamond moment of inertia (Stage-4 MoI gap fix)", () => {
  it("computes I = b·h³/48 for a known rhombus section", () => {
    const base = 0.045, height = 0.006;
    const res = momentOfInertia("rhombus", { base, height });
    const expected = (base * Math.pow(height, 3)) / 48;
    assert.equal(res.error, undefined);
    assert.ok(Math.abs(res.value - expected) < 1e-15, `${res.value} vs ${expected}`);
  });

  it("'diamond' is an accepted alias for 'rhombus' and returns the identical value", () => {
    const params = { base: 0.09, height: 0.012 };
    const a = momentOfInertia("rhombus", params);
    const b = momentOfInertia("diamond", params);
    assert.equal(a.value, b.value);
  });

  it("is EXACTLY 1/4 of the same-b×h bounding-box rectangle's I (proving the ~4x-too-stiff caveat is fixed)", () => {
    for (const [base, height] of [[0.045, 0.006], [1, 1], [2.3, 0.4], [0.09, 0.012]]) {
      const rhombusI = momentOfInertia("rhombus", { base, height }).value;
      const rectI = momentOfInertia("rectangle", { base, height }).value;
      const ratio = rhombusI / rectI;
      assert.ok(Math.abs(ratio - 0.25) < 1e-12, `base=${base} height=${height}: ratio ${ratio} should be exactly 0.25`);
    }
  });

  it("rejects non-numeric inputs honestly (no NaN result)", () => {
    const res = momentOfInertia("rhombus", { base: "x", height: 1 });
    assert.equal(typeof res.error, "string");
  });
});

describe("fea-gate.js#correctedMomentOfInertia — the exact 4x correction, tied to the real rhombus formula", () => {
  it("dividing a rectangle-formula-approximated (approximation:true) station's I by 4 reproduces momentOfInertia('rhombus', ...) bit-for-bit", () => {
    const base = 0.045, height = 0.006;
    const rectApproxI = momentOfInertia("rectangle", { base, height }).value; // what parametric-mesh.js's crossSectionProps stores for a diamond station
    const trueRhombusI = momentOfInertia("rhombus", { base, height }).value; // the real engine value for the same b,h
    const station = { momentOfInertia: rectApproxI, approximation: true };
    assert.equal(correctedMomentOfInertia(station), trueRhombusI);
  });

  it("leaves a non-approximation station's I untouched (circle/rect stations are already exact)", () => {
    const station = { momentOfInertia: 12.34, approximation: false };
    assert.equal(correctedMomentOfInertia(station), 12.34);
  });
});

describe("parametric-mesh.js sword mesh — the corrected diamond MoI is what the gate actually sees", () => {
  it("the blade (diamond) stations' corrected I is exactly 1/4 of the raw beam co-product's approximated I", () => {
    const mesh = generateSwordMesh();
    // Exclude the exact geometric tip station (taper collapses to zero
    // width/thickness there, so momentOfInertia is legitimately 0 — a 0/0
    // ratio, not a violation of the 1/4 relationship).
    const bladeStations = mesh.beam.stations.filter((s) => s.approximation === true && s.momentOfInertia > 0);
    assert.ok(bladeStations.length > 0, "sword mesh must have diamond blade stations with non-zero section");
    for (const st of bladeStations) {
      assert.ok(Math.abs(correctedMomentOfInertia(st) / st.momentOfInertia - 0.25) < 1e-9);
    }
  });
});

describe("runFEA — hand-built simple cantilever vs. the analytic beam-theory oracle (compute-don't-guess)", () => {
  // A single-element cantilever: node A fixed at the origin, node B free at
  // x = L, a transverse tip load P. This is the textbook Euler-Bernoulli
  // case: max bending moment M = P·L occurs at the fixed root; the FEA
  // solver's own reported momentI (see fea-reactions.test.js, which already
  // pins the reaction-moment side of this same model) must equal that, and
  // feeding it through physics-compute.js's OWN bendingStress (σ = M·c/I —
  // no re-derivation here) must equal the FEA's own reported bendingStress.
  const L = 0.5; // m
  const P = 200; // N, transverse
  const base = 0.05, height = 0.01; // m — a plain rectangular test section
  const area = base * height;
  const I = momentOfInertia("rectangle", { base, height }).value;
  const c = height / 2; // extreme-fiber distance
  const E = 200e9; // Pa (steel)

  const model = {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", nodeI: "A", nodeJ: "B", area, momentI: I, elasticModulus: E, depthIn: height },
    ],
    supports: [{ nodeId: "A", type: "fixed" }],
    loads: [{ nodeId: "B", Fy: P }],
  };

  const res = runFEA(model);

  it("solves successfully", () => {
    assert.equal(res.ok, true);
  });

  it("root bending moment matches the analytic cantilever result M = P·L", () => {
    const mf = res.memberForces[0];
    const expected = P * L;
    assert.ok(Math.abs(mf.maxMoment - expected) / expected < 1e-6, `maxMoment ${mf.maxMoment} vs ${expected}`);
  });

  it("FEA-reported bending stress matches physics-compute.js's own σ = M·c/I for that same moment", () => {
    const mf = res.memberForces[0];
    const expectedStress = bendingStress({ moment: mf.maxMoment, momentI: I, distance: c }).value;
    const feaStress = res.stresses[0].bendingStress;
    assert.ok(Math.abs(feaStress - expectedStress) / expectedStress < 1e-6, `FEA ${feaStress} vs analytic ${expectedStress}`);
  });
});

describe("structuralCheck — the gate discriminates a robust sword from a brittle one", () => {
  it("honestly reports a non-passing default-thickness sword (marginal — feeds the optimizeToPass test below)", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.006 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, false);
    assert.ok(check.maxUtilization > 1, `expected maxUtilization > 1, got ${check.maxUtilization}`);
    assert.ok(check.failingStations.length > 0);
  });

  it("a robust (2x-thickened) blade PASSES the gate", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, true);
    assert.ok(check.maxUtilization < 1, `expected maxUtilization < 1, got ${check.maxUtilization}`);
    assert.equal(check.failingStations.length, 0);
  });

  it("a deliberately brittle (half-thickness) blade FAILS the gate hard — proving the gate actually rejects", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, false);
    assert.ok(check.maxUtilization > 1, `expected maxUtilization > 1, got ${check.maxUtilization}`);
    assert.ok(check.failingStations.length > 0);
  });

  it("robust sword's utilization is meaningfully lower than the brittle sword's (the gate actually discriminates, not just a coin flip)", () => {
    const robust = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const brittle = generateSwordMesh({ bladeBaseThickness: 0.003 });
    const robustCheck = structuralCheck(robust.beam, { totalLength: robust.meta.totalLength });
    const brittleCheck = structuralCheck(brittle.beam, { totalLength: brittle.meta.totalLength });
    assert.ok(robustCheck.maxUtilization < brittleCheck.maxUtilization);
    // Order-of-magnitude separation, not a marginal difference.
    assert.ok(brittleCheck.maxUtilization / robustCheck.maxUtilization > 10);
  });

  it("uses the honest DEFAULT_SAFETY_FACTOR (1.5) unless overridden", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.safetyFactor, DEFAULT_SAFETY_FACTOR);
  });

  it("never fabricates a pass — honest failure on an unknown material", () => {
    const mesh = generateSwordMesh();
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, material: "unobtainium-9000" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unknown_material");
  });

  it("never fabricates a pass — honest failure on a missing totalLength", () => {
    const mesh = generateSwordMesh();
    const check = structuralCheck(mesh.beam, {});
    assert.equal(check.ok, false);
    assert.equal(check.reason, "missing_total_length");
  });

  it("never fabricates a pass — honest failure on an unsupported use case", () => {
    const mesh = generateSwordMesh();
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "torsion" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unsupported_use_case");
  });
});

describe("optimizeToPass — bounded adjust-and-rerun loop", () => {
  it("converges a marginal blade (default sword thickness) to a passing configuration", async () => {
    const result = await optimizeToPass({ bladeBaseThickness: 0.006 }, { generate: generateSwordMesh, maxIters: 12 });
    assert.equal(result.ok, true);
    assert.equal(result.check.ok, true);
    assert.ok(result.params.bladeBaseThickness > 0.006, "must have thickened the failing dimension");
    assert.ok(result.history.length >= 1);
    assert.equal(result.history[0].ok, false, "first attempt (unmodified default) should honestly fail before converging");
    assert.equal(result.history.at(-1).ok, true);
  });

  it("honestly reports non-convergence on an unreasonably demanding load within a bounded iteration budget", async () => {
    const result = await optimizeToPass(
      { bladeBaseThickness: 0.006 },
      { generate: generateSwordMesh, maxIters: 3, tipLoadN: 100000 },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "did_not_converge");
    assert.equal(result.history.length, 3);
    // Never silently reports the last (still-failing) attempt as a pass.
    assert.ok(result.history.every((h) => h.ok === false));
  });

  it("stops early (without burning the full iteration budget) on a hard precondition failure that thickening cannot fix", async () => {
    const result = await optimizeToPass(
      { bladeBaseThickness: 0.006 },
      { generate: generateSwordMesh, maxIters: 12, material: "unobtainium-9000" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "cannot_converge");
    assert.ok(result.history.length < 12, "should not spin through dead iterations on a non-geometric failure");
  });
});
