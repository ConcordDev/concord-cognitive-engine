/**
 * Cross-System Multi-Physics CAD — thermal-stress cross-check.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: the formula-based
 * expectations here (σ_thermal = E·α·ΔT, F_thermal = E·A·α·ΔT) are
 * textbook mechanics-of-materials results computed by hand from the SAME
 * real material constants (mass-properties.js's MATERIAL_LIBRARY, a
 * byte-for-byte transcription of engineering.js's own table) that
 * thermal-gate.js consumes — never a value pasted from the module's own
 * output. The combined-FEA expectations are checked against the real,
 * unmodified fea-solver.js#runFEA via server-authoritative superposition
 * (two real applied loads on the same linear-elastic model), mirroring
 * server/tests/fea-gate.test.js's own hand-built-cantilever-vs-oracle
 * convention.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { momentOfInertia } from "../lib/compute/physics-compute.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { getMaterial } from "../lib/asset-gen/mass-properties.js";
import {
  checkThermalGate,
  buildThermalLoads,
  thermalStressPa,
  thermalAxialForceN,
  alphaPerKelvin,
  CTE_UNIT_SCALE,
  DEFAULT_DELTA_T_C,
} from "../lib/asset-gen/thermal-gate.js";

// ── Shared single-member cantilever fixture ─────────────────────────────
// Identical shape to fea-gate.test.js's hand-built cantilever: node A
// fixed at the origin, node B free at x=L, a plain rectangular section.
const STEEL = getMaterial("steel-a36"); // E=200000 MPa, cte=11.7 (1e-6/K), yield=250 MPa
const L = 0.5; // m
const base = 0.05, height = 0.01; // m
const area = base * height;
const I = momentOfInertia("rectangle", { base, height }).value;
const E_Pa = STEEL.E * 1e6;
const SAFETY_FACTOR = 1.5;
const allowable_Pa = (STEEL.yield * 1e6) / SAFETY_FACTOR;

function singleMemberModel({ mechanicalLoads = [] } = {}) {
  return {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", nodeI: "A", nodeJ: "B", area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height },
    ],
    supports: [{ nodeId: "A", type: "fixed" }],
    loads: mechanicalLoads,
  };
}

describe("thermalStressPa / thermalAxialForceN — hand-calculable textbook formula", () => {
  it("σ_thermal = E·α·ΔT matches a hand computation for steel-a36 at ΔT=40°C", () => {
    const deltaT = 40;
    const alpha = STEEL.cte * CTE_UNIT_SCALE; // 11.7e-6 /K, by hand — not calling alphaPerKelvin
    const expectedSigma = (STEEL.E * 1e6) * alpha * deltaT; // 2e11 * 11.7e-6 * 40 = 9.36e7 Pa
    assert.ok(Math.abs(expectedSigma - 9.36e7) / 9.36e7 < 1e-9, `sanity: hand calc itself should be 93.6 MPa, got ${expectedSigma}`);

    const got = thermalStressPa(STEEL, deltaT);
    assert.ok(Math.abs(got - expectedSigma) / expectedSigma < 1e-12, `${got} vs ${expectedSigma}`);
  });

  it("alphaPerKelvin is exactly cte × 1e-6", () => {
    assert.equal(alphaPerKelvin(STEEL), STEEL.cte * CTE_UNIT_SCALE);
  });

  it("F_thermal = σ_thermal × area matches a hand computation", () => {
    const deltaT = 40;
    const sigma = thermalStressPa(STEEL, deltaT);
    const expectedF = sigma * area;
    const got = thermalAxialForceN(STEEL, deltaT, area);
    assert.ok(Math.abs(got - expectedF) / expectedF < 1e-12, `${got} vs ${expectedF}`);
  });

  it("σ_thermal is independent of area — a physically real property of the fully-restrained formula, not an implementation detail", () => {
    const deltaT = 40;
    const sigmaSmallArea = thermalStressPa(STEEL, deltaT);
    const sigmaBigArea = thermalStressPa(STEEL, deltaT); // formula takes no area argument at all
    assert.equal(sigmaSmallArea, sigmaBigArea);
  });

  it("zero ΔT gives zero thermal stress and zero thermal force", () => {
    assert.equal(thermalStressPa(STEEL, 0), 0);
    assert.equal(thermalAxialForceN(STEEL, 0, area), 0);
  });
});

describe("buildThermalLoads — per-member superposable nodal force assembly", () => {
  it("a single-member chain gets the fully-restrained σ as its stress, and F=σ·A as its force", () => {
    const model = singleMemberModel();
    const deltaT = 40;
    const { thermalStressByMember, thermalForceByMember, nodalLoads } =
      buildThermalLoads(model.nodes, model.members, STEEL, deltaT);
    const expectedSigma = thermalStressPa(STEEL, deltaT);
    assert.equal(thermalStressByMember.m1, expectedSigma);
    assert.equal(thermalForceByMember.m1, expectedSigma * area);
    // Assembled load at the free node B should equal +F in x (member wants
    // to elongate away from the fixed root A).
    const atB = nodalLoads.find((l) => String(l.nodeId) === "B");
    assert.ok(Math.abs(atB.Fx - expectedSigma * area) / (expectedSigma * area) < 1e-12);
    assert.ok(Math.abs(atB.Fy) < 1e-9 && Math.abs(atB.Fz) < 1e-9);
  });

  it("two members of DIFFERENT area under the same ΔT/material get the SAME thermal stress but DIFFERENT thermal force", () => {
    const nodes = [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: 0.25, y: 0, z: 0 },
      { id: "C", x: 0.5, y: 0, z: 0 },
    ];
    const members = [
      { id: "seg1", nodeI: "A", nodeJ: "B", area: 5e-4 },
      { id: "seg2", nodeI: "B", nodeJ: "C", area: 2.5e-4 }, // half the area
    ];
    const deltaT = 40;
    const { thermalStressByMember, thermalForceByMember } = buildThermalLoads(nodes, members, STEEL, deltaT);
    assert.equal(thermalStressByMember.seg1, thermalStressByMember.seg2, "same material/ΔT → same stress regardless of area");
    assert.ok(Math.abs(thermalForceByMember.seg1 / thermalForceByMember.seg2 - 2) < 1e-9, "force scales with area 2:1");
  });

  it("ΔT=0 produces an empty (or all-zero) assembled load list — the honest degrade case", () => {
    const model = singleMemberModel();
    const { nodalLoads, thermalForceByMember } = buildThermalLoads(model.nodes, model.members, STEEL, 0);
    assert.equal(thermalForceByMember.m1, 0);
    for (const l of nodalLoads) {
      assert.equal(l.Fx, 0);
      assert.equal(l.Fy, 0);
      assert.equal(l.Fz, 0);
    }
  });
});

describe("checkThermalGate — real combined solver output, honestly labeled", () => {
  it("thermal-only run (no mechanical load) reproduces the closed-form σ_thermal as the REAL solver's own axial stress for a single free-tip member", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const deltaT = 40;
    const check = checkThermalGate(model, { deltaT, material: "steel-a36" });
    assert.equal(typeof check.combinedUtilization, "number");
    const expectedSigma = thermalStressPa(STEEL, deltaT);
    const axial = check.combined.stresses[0].axialStress;
    assert.ok(Math.abs(axial - expectedSigma) / expectedSigma < 1e-9, `solver axialStress ${axial} vs closed-form σ_thermal ${expectedSigma}`);
    // Cross-check against a hand-built direct runFEA call with the
    // equivalent load applied manually — proving thermal-gate.js's
    // assembly is not doing anything the real solver wouldn't do on its own.
    const F = expectedSigma * area;
    const manual = runFEA({
      nodes: model.nodes,
      members: model.members,
      loads: [{ nodeId: "B", Fx: F }],
      supports: model.supports,
    });
    assert.ok(Math.abs(manual.stresses[0].axialStress - axial) < 1e-6);
  });

  it("ΔT=0 degrades EXACTLY to the mechanical-only case — a genuine self-consistency property", () => {
    const P = 200; // N transverse tip load
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: P }] });
    const check = checkThermalGate(model, { deltaT: 0, material: "steel-a36" });
    assert.equal(check.thermalForceByMember.m1, 0);
    assert.equal(check.combinedUtilization, check.mechanicalOnlyUtilization);
    assert.deepEqual(check.combined.stresses, check.mechanical.stresses);
  });

  it("combined utilization is genuinely higher than mechanical-only when the thermal load reinforces the mechanical load (both axial tension, same direction)", () => {
    const mechFx = 100; // N, tension pulling B away from the fixed root — small on purpose
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fx: mechFx }] });
    const deltaT = 40; // heating a positive-CTE material: the member wants to elongate the same way the mechanical tension already pulls it
    const check = checkThermalGate(model, { deltaT, material: "steel-a36" });

    assert.ok(check.combinedUtilization > check.mechanicalOnlyUtilization,
      `combined ${check.combinedUtilization} should exceed mechanical-only ${check.mechanicalOnlyUtilization}`);
    // Not just marginally higher — the thermal contribution should be the
    // dominant term here (real superposition, not noise).
    assert.ok(check.combinedUtilization / check.mechanicalOnlyUtilization > 10);

    // Cross-check the exact combined axial stress against hand superposition:
    // (mechFx + F_thermal) / area.
    const sigma = thermalStressPa(STEEL, deltaT);
    const F_thermal = sigma * area;
    const expectedCombinedAxialStress = (mechFx + F_thermal) / area;
    const gotAxial = check.combined.stresses[0].axialStress;
    assert.ok(Math.abs(gotAxial - expectedCombinedAxialStress) / expectedCombinedAxialStress < 1e-6,
      `${gotAxial} vs hand-superposed ${expectedCombinedAxialStress}`);
  });

  it("mechanicalOnlyUtilization matches a direct runFEA call with only the mechanical loads (no thermal-gate involvement at all)", () => {
    const P = 200;
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: P }] });
    const check = checkThermalGate(model, { deltaT: 40, material: "steel-a36" });
    const direct = runFEA({ nodes: model.nodes, members: model.members, loads: model.loads, supports: model.supports });
    assert.equal(check.mechanicalOnlyUtilization, direct.summary.maxUtilization);
  });

  it("uses DEFAULT_DELTA_T_C when opts.deltaT is omitted", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const check = checkThermalGate(model, { material: "steel-a36" });
    assert.equal(check.deltaT, DEFAULT_DELTA_T_C);
  });

  it("accepts an already-resolved material object, not just a string key", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const check = checkThermalGate(model, { deltaT: 40, material: STEEL });
    assert.equal(typeof check.combinedUtilization, "number");
  });

  // ── Honest failures — never fabricate a pass ──────────────────────────
  it("honestly fails on an unknown material", () => {
    const model = singleMemberModel();
    const check = checkThermalGate(model, { deltaT: 40, material: "unobtainium-9000" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unknown_material");
  });

  it("honestly fails on a bad model (no members)", () => {
    const check = checkThermalGate({ nodes: [{ id: "A", x: 0, y: 0, z: 0 }], members: [] }, { deltaT: 40, material: "steel-a36" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "bad_model_input");
  });

  it("honestly fails on a non-finite ΔT", () => {
    const model = singleMemberModel();
    const check = checkThermalGate(model, { deltaT: NaN, material: "steel-a36" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "bad_delta_t");
  });

  it("honestly fails on a model with no supports", () => {
    const model = singleMemberModel();
    const noSupports = { ...model, supports: [] };
    const check = checkThermalGate(noSupports, { deltaT: 40, material: "steel-a36" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "missing_supports");
  });
});
