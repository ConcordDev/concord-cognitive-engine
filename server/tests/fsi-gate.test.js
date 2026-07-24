/**
 * Wave W1-B — non-Newtonian fluid-structure interaction gate.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine, every expected value
 * here is either a hand-derivable closed-form beam/pipe-flow result, or
 * cross-checked against the codebase's own unmodified runFEA / the flow
 * module's own oracle-matched primitives — never a value pasted from
 * this module's own output. The convergence/divergence numbers below
 * were empirically measured against this exact model (not guessed) —
 * see the module header for why the physics genuinely can diverge.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkFsiGate,
  assertFsiModelSupported,
  DEFAULT_GAP_TOLERANCE,
} from "../lib/asset-gen/fsi-gate.js";
import { powerLawPipeFlow } from "../lib/simulation/non-newtonian-flow.js";

// ── Shared wall model builder — a cantilever beam along global X ───────
// (fixed at node 0, free at the far end), matching the orientation the
// module requires. Mirrors aero-gate.test.js/thermal-gate.test.js's own
// convention of building the model directly rather than going through a
// generator this module doesn't own.
function buildWallModel({
  length = 1,
  wallElements = 16,
  area = 0.0005,
  momentI = 5e-6,
  E = 1e15,
  allowableStress = 250e6,
  loads = [],
} = {}) {
  const nodes = [];
  for (let i = 0; i <= wallElements; i++) {
    nodes.push({ id: i, x: (length * i) / wallElements, y: 0, z: 0 });
  }
  const members = [];
  for (let i = 0; i < wallElements; i++) {
    members.push({
      id: `w${i}`,
      nodeI: i,
      nodeJ: i + 1,
      area,
      momentI,
      elasticModulus: E,
      allowableStress,
    });
  }
  const supports = [{ nodeId: 0, fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }];
  return { nodes, members, supports, loads };
}

// Shared fluid + channel parameters — a viscous power-law fluid (K=1
// Pa·s^n, n=0.7 mildly shear-thinning) through a 1cm-radius, 1m channel
// under a 500 Pa drop; chosen (and hand-verified via
// non-newtonian-flow.js#generalisedReynolds) to sit at Re≈0.22 — solidly
// laminar, so the laminar precondition never fires spuriously in these
// structural-coupling tests.
const K = 1, N_FLOW = 0.7, DELTA_P = 500, DENSITY = 1000, NOMINAL_GAP = 0.01, CHANNEL_WIDTH = 1, LENGTH = 1;

describe("assertFsiModelSupported — orientation guard, before any runFEA call", () => {
  it("accepts a member lying along global X", () => {
    const model = buildWallModel({ wallElements: 4 });
    const check = assertFsiModelSupported(model.nodes, model.members);
    assert.equal(check.ok, true);
  });

  it("refuses a member lying along global Y — the fea-solver silent-zero-stiffness hazard", () => {
    const nodes = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 0, y: 1, z: 0 },
    ];
    const members = [
      { id: "y0", nodeI: 0, nodeJ: 1, area: 0.0005, momentI: 5e-6, elasticModulus: 2e11, allowableStress: 250e6 },
    ];
    const check = assertFsiModelSupported(nodes, members);
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unsupported_member_orientation");
    assert.deepEqual(check.memberIds, ["y0"]);
  });

  it("checkFsiGate itself refuses the Y-oriented model and NEVER reaches runFEA (no solver-shaped fields on the result)", () => {
    const nodes = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 0, y: 1, z: 0 },
    ];
    const members = [
      { id: "y0", nodeI: 0, nodeJ: 1, area: 0.0005, momentI: 5e-6, elasticModulus: 2e11, allowableStress: 250e6 },
    ];
    const model = { nodes, members, supports: [{ nodeId: 0, fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }], loads: [] };
    const res = checkFsiGate(model, { fluidModel: "powerLaw", K, n: N_FLOW, deltaP: DELTA_P, density: DENSITY, nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "unsupported_member_orientation");
    assert.deepEqual(res.memberIds, ["y0"]);
    // Never fabricated a solver-shaped result.
    assert.equal(res.flowRate, undefined);
    assert.equal(res.combinedUtilization, undefined);
  });
});

describe("checkFsiGate — rigid-wall limit reproduces the uncoupled closed form", () => {
  it("E→1e15 Pa: deflection≈0, converges in ≤2 iterations, flowRate matches the UNCOUPLED powerLawPipeFlow to <1e-9 relative", () => {
    const model = buildWallModel({ length: LENGTH, wallElements: 16, E: 1e15 });
    const res = checkFsiGate(model, {
      fluidModel: "powerLaw", K, n: N_FLOW, deltaP: DELTA_P, density: DENSITY,
      nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH,
    });
    assert.equal(res.ok, true);
    assert.ok(res.converged);
    assert.ok(res.iterations <= 2, `expected ≤2 iterations for a rigid wall, got ${res.iterations}`);

    const uncoupledQ = powerLawPipeFlow({ K, n: N_FLOW, diameter: 2 * NOMINAL_GAP, lengthM: LENGTH, pressureDropPa: DELTA_P });
    const relErr = Math.abs(res.flowRate - uncoupledQ) / uncoupledQ;
    assert.ok(relErr < 1e-9, `uncoupled Q=${uncoupledQ} vs coupled flowRate=${res.flowRate}, relErr=${relErr}`);

    // Deflection really is negligible relative to the channel gap.
    const maxDy = Math.max(...res.deflection.map((d) => Math.abs(d.dy)));
    assert.ok(maxDy / NOMINAL_GAP < 1e-4, `expected negligible deflection, got maxDy=${maxDy}`);

    assert.ok(/no wake, turbulence/i.test(res.approximationCaveat));
  });
});

describe("checkFsiGate — zero-pressure-drop limit is an exact self-consistency check", () => {
  it("ΔP=0 ⇒ zero flow, zero FSI load, combinedUtilization === mechanicalOnlyUtilization EXACTLY", () => {
    const model = buildWallModel({ length: LENGTH, wallElements: 16, loads: [{ nodeId: 16, Fy: 5 }] });
    const res = checkFsiGate(model, {
      fluidModel: "powerLaw", K, n: N_FLOW, deltaP: 0, density: DENSITY,
      nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH,
    });
    assert.equal(res.ok, true);
    assert.equal(res.flowRate, 0);
    assert.equal(res.iterations, 1);
    assert.equal(res.combinedUtilization, res.mechanicalOnlyUtilization,
      `combined ${res.combinedUtilization} must EXACTLY equal mechanical-only ${res.mechanicalOnlyUtilization} at ΔP=0`);
    assert.deepEqual(res.combined.stresses, res.mechanical.stresses);
  });
});

describe("checkFsiGate — mesh convergence on a rigid-wall case (force-only lumping)", () => {
  it("deflection error shrinks ~4x per doubling (O(h²)); member moment is exact at every N", () => {
    const E = 1e15, area = 0.0005, momentI = 5e-6;
    // Analytic uniform-distributed-load cantilever oracle: at a rigid
    // wall the local gap stays ≈ nominalGap everywhere, so the per-member
    // load intensity is uniform w = (ΔP/L)·channelWidth (the total
    // pressure drop spread evenly over the channel length), and the
    // exact Euler-Bernoulli results for a cantilever under a uniform
    // transverse line load w are tip deflection wL⁴/(8EI) and root
        // moment wL²/2.
    const w = (DELTA_P / LENGTH) * CHANNEL_WIDTH;
    const analyticTipDeflection = (w * Math.pow(LENGTH, 4)) / (8 * E * momentI);
    const analyticRootMoment = (w * LENGTH * LENGTH) / 2;
    const c = Math.sqrt(area) / 2; // fea-solver's own extreme-fiber fallback (no depthIn supplied)
    const analyticRootBendingStress = (analyticRootMoment * c) / momentI;

    const errors = [];
    const rootStresses = [];
    for (const wallElements of [8, 16, 32, 64]) {
      const model = buildWallModel({ length: LENGTH, wallElements, area, momentI, E });
      const res = checkFsiGate(model, {
        fluidModel: "powerLaw", K, n: N_FLOW, deltaP: DELTA_P, density: DENSITY,
        nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH,
      });
      assert.equal(res.ok, true, `N=${wallElements} should converge on a rigid wall`);
      const tipDy = res.deflection[res.deflection.length - 1].dy;
      errors.push(Math.abs(tipDy - analyticTipDeflection) / analyticTipDeflection);
      rootStresses.push(res.combined.utilization[0].combinedStress);
    }

    // O(h²): each doubling of element count should cut the error ~4x.
    for (let i = 1; i < errors.length; i++) {
      const ratio = errors[i - 1] / errors[i];
      assert.ok(ratio > 3.5 && ratio < 4.5, `expected ~4x error reduction at step ${i}, got ratio=${ratio} (errors=${errors})`);
    }

    // Force-only lumping gives the EXACT member moment at every mesh
    // density (unlike consistent FE lumping, which under-reports it at
    // coarse N) — the root member's bending stress should match the
    // analytic value at every N, not just in the fine-mesh limit.
    for (const stress of rootStresses) {
      const relErr = Math.abs(stress - analyticRootBendingStress) / analyticRootBendingStress;
      assert.ok(relErr < 1e-6, `expected root stress ≈ ${analyticRootBendingStress} at every N, got ${stress} (relErr ${relErr})`);
    }
  });
});

describe("checkFsiGate — honest non-convergence is a real, reachable outcome", () => {
  it("an over-compliant channel with relaxation:1.0 NEVER reports ok:true — did_not_converge or coupling_diverged, with a residualHistory", () => {
    // E=1e11 Pa on this section is soft enough that the steep R^-(1+3n)
    // pressure-gradient feedback (narrower gap → steeper local gradient →
    // more inward push) makes the un-relaxed (ω=1.0) Picard map diverge —
    // empirically measured against this exact model/fluid combination,
    // not tuned to force a specific outcome after the fact.
    const model = buildWallModel({ length: LENGTH, wallElements: 16, E: 1e11 });
    const res = checkFsiGate(model, {
      fluidModel: "powerLaw", K, n: N_FLOW, deltaP: DELTA_P, density: DENSITY,
      nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH, relaxation: 1.0, maxIters: 40,
    });
    assert.equal(res.ok, false);
    assert.ok(["did_not_converge", "coupling_diverged"].includes(res.reason),
      `expected an honest non-convergence reason, got ${res.reason}`);
    assert.ok(Array.isArray(res.residualHistory) && res.residualHistory.length > 0);
  });

  it("the SAME over-compliant channel under default relaxation (0.5) does not silently fabricate a pass either", () => {
    // Damping slows the divergence but this section is soft enough that
    // it still doesn't settle inside the iteration budget — the module's
    // job is to say so honestly, not to claim convergence it didn't
    // reach.
    const model = buildWallModel({ length: LENGTH, wallElements: 16, E: 1e11 });
    const res = checkFsiGate(model, {
      fluidModel: "powerLaw", K, n: N_FLOW, deltaP: DELTA_P, density: DENSITY,
      nominalGap: NOMINAL_GAP, channelWidth: CHANNEL_WIDTH, maxIters: 40,
    });
    if (res.ok) {
      // If a future tolerance/relaxation tweak makes this particular
      // section converge under damping, it must be a REAL converged
      // answer (finite, physically bounded gap), never a NaN/collapsed
      // fabrication.
      assert.ok(res.gapProfile.every((g) => Number.isFinite(g) && g > 0));
    } else {
      assert.ok(["did_not_converge", "coupling_diverged", "gap_collapsed"].includes(res.reason));
    }
  });

  it("gapTolerance default is documented and used when the caller omits it", () => {
    assert.equal(DEFAULT_GAP_TOLERANCE, 1e-4);
  });
});

describe("checkFsiGate — honest input failures, never a fabricated pass", () => {
  it("refuses a negative pressure drop", () => {
    const model = buildWallModel({ wallElements: 4 });
    const res = checkFsiGate(model, { fluidModel: "powerLaw", K, n: N_FLOW, deltaP: -5, density: DENSITY, nominalGap: NOMINAL_GAP });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_delta_p");
  });

  it("refuses a missing density (never invents a fluid density)", () => {
    const model = buildWallModel({ wallElements: 4 });
    const res = checkFsiGate(model, { fluidModel: "powerLaw", K, n: N_FLOW, deltaP: 500, nominalGap: NOMINAL_GAP });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_density");
  });

  it("refuses an unsupported fluid model", () => {
    const model = buildWallModel({ wallElements: 4 });
    const res = checkFsiGate(model, { fluidModel: "bingham", deltaP: 500, density: DENSITY, nominalGap: NOMINAL_GAP });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "unsupported_fluid_model");
  });

  it("refuses a model with no supports", () => {
    const model = buildWallModel({ wallElements: 4 });
    const noSupports = { ...model, supports: [] };
    const res = checkFsiGate(noSupports, { fluidModel: "powerLaw", K, n: N_FLOW, deltaP: 500, density: DENSITY, nominalGap: NOMINAL_GAP });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_supports");
  });

  it("refuses a turbulent-regime input rather than extrapolating the laminar closed form", () => {
    // A tiny viscosity + large gap drives Re well past 4000.
    const model = buildWallModel({ wallElements: 4 });
    const res = checkFsiGate(model, {
      fluidModel: "powerLaw", K: 0.0001, n: 1, deltaP: 5000, density: 1000,
      nominalGap: 0.5, channelWidth: 1,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "non_laminar_regime_unsupported");
    assert.equal(typeof res.Re, "number");
    assert.ok(res.Re > 2300);
  });
});
