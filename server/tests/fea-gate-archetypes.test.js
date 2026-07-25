/**
 * Program C, Stage 4 continuation — FEA use cases for the four non-sword
 * mesh archetypes (spear/staff/mace/shield) added to parametric-mesh.js.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: every load figure used
 * below is either the SAME derived constant fea-gate.js exports (so this
 * file re-derives nothing by hand — it calls the real
 * `estimateImpactForceN` helper and cross-checks the module's own exported
 * constants against it) or the real, live-computed structural-check output
 * for the archetype's actual default geometry. No expected number here is
 * hand-typed without a formula behind it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateSwordMesh,
  generateSpearMesh,
  generateStaffMesh,
  generateMaceMesh,
  generateShieldMesh,
} from "../lib/asset-gen/parametric-mesh.js";
import { massProperties } from "../lib/asset-gen/mass-properties.js";
import {
  structuralCheck,
  optimizeToPass,
  estimateImpactForceN,
  STAFF_THRUST_AXIAL_N,
  STAFF_STRIKE_SPEED_MS,
  STAFF_STRIKE_STOP_DISTANCE_M,
  STAFF_REFERENCE_MASS_KG,
  DEFAULT_STAFF_STRIKE_TRANSVERSE_N,
  MACE_IMPACT_SPEED_MS,
  MACE_IMPACT_STOP_DISTANCE_M,
  MACE_REFERENCE_MASS_KG,
  DEFAULT_MACE_IMPACT_AXIAL_N,
  SHIELD_BLOW_SPEED_MS,
  SHIELD_BLOW_STOP_DISTANCE_M,
  SHIELD_ATTACKER_MASS_KG,
  DEFAULT_SHIELD_BLOW_AXIAL_N,
} from "../lib/asset-gen/fea-gate.js";

describe("estimateImpactForceN — the derivation itself, not just its output", () => {
  it("computes F = KE/d = (1/2 m v^2)/d exactly", () => {
    assert.equal(estimateImpactForceN(2, 3, 0.5), (0.5 * 2 * 9) / 0.5);
  });
  it("returns NaN honestly on any non-positive input (never fabricates a force from garbage)", () => {
    assert.ok(Number.isNaN(estimateImpactForceN(0, 3, 0.5)));
    assert.ok(Number.isNaN(estimateImpactForceN(2, -1, 0.5)));
    assert.ok(Number.isNaN(estimateImpactForceN(2, 3, 0)));
  });
});

describe("derived use-case load constants are actually DERIVED, not pasted", () => {
  it("DEFAULT_STAFF_STRIKE_TRANSVERSE_N reproduces from the exported inputs via estimateImpactForceN", () => {
    const recomputed = Math.round(
      estimateImpactForceN(STAFF_REFERENCE_MASS_KG, STAFF_STRIKE_SPEED_MS, STAFF_STRIKE_STOP_DISTANCE_M),
    );
    assert.equal(DEFAULT_STAFF_STRIKE_TRANSVERSE_N, recomputed);
  });

  it("STAFF_REFERENCE_MASS_KG matches the REAL default staff mass (generateStaffMesh -> massProperties, douglas-fir)", () => {
    const mesh = generateStaffMesh({});
    const mp = massProperties(mesh, "douglas-fir");
    assert.ok(Math.abs(mp.mass_kg - STAFF_REFERENCE_MASS_KG) < 0.001,
      `live mass ${mp.mass_kg} vs transcribed constant ${STAFF_REFERENCE_MASS_KG}`);
  });

  it("DEFAULT_MACE_IMPACT_AXIAL_N reproduces from the exported inputs via estimateImpactForceN", () => {
    const recomputed = Math.round(
      estimateImpactForceN(MACE_REFERENCE_MASS_KG, MACE_IMPACT_SPEED_MS, MACE_IMPACT_STOP_DISTANCE_M),
    );
    assert.equal(DEFAULT_MACE_IMPACT_AXIAL_N, recomputed);
  });

  it("MACE_REFERENCE_MASS_KG matches the REAL default mace mass (generateMaceMesh -> massProperties, steel-a36)", () => {
    const mesh = generateMaceMesh({});
    const mp = massProperties(mesh, "steel-a36");
    assert.ok(Math.abs(mp.mass_kg - MACE_REFERENCE_MASS_KG) < 0.001,
      `live mass ${mp.mass_kg} vs transcribed constant ${MACE_REFERENCE_MASS_KG}`);
  });

  it("DEFAULT_SHIELD_BLOW_AXIAL_N reproduces from the exported inputs via estimateImpactForceN", () => {
    const recomputed = Math.round(
      estimateImpactForceN(SHIELD_ATTACKER_MASS_KG, SHIELD_BLOW_SPEED_MS, SHIELD_BLOW_STOP_DISTANCE_M),
    );
    assert.equal(DEFAULT_SHIELD_BLOW_AXIAL_N, recomputed);
  });

  it("SHIELD_ATTACKER_MASS_KG matches the REAL default SWORD mass ('material properties already in the tree', not an invented attacker weight)", () => {
    const mesh = generateSwordMesh({});
    const mp = massProperties(mesh, "steel-a36");
    assert.ok(Math.abs(mp.mass_kg - SHIELD_ATTACKER_MASS_KG) < 0.001,
      `live sword mass ${mp.mass_kg} vs transcribed constant ${SHIELD_ATTACKER_MASS_KG}`);
  });
});

describe("spear — unmodified 'sword-bending' gate (same diamond blade cross-section, no dedicated use case needed)", () => {
  it("converges the default spear head at maxUtilization ~0.273 (matches the precedent this task was handed)", () => {
    const mesh = generateSpearMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, true);
    assert.ok(Math.abs(check.maxUtilization - 0.27316574895381) < 1e-9, `got ${check.maxUtilization}`);
    assert.deepEqual(check.failingStations, []);
  });
});

describe("mace-impact — axial compression through handle→collar→head from a swing impact", () => {
  it("the default mace PASSES the impact-compression check with real, non-trivial margin (not 0%, not 100%)", () => {
    const mesh = generateMaceMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "mace-impact", material: "steel-a36" });
    assert.equal(check.ok, true, `expected a pass, got ${JSON.stringify(check)}`);
    assert.equal(check.axialLoadN, DEFAULT_MACE_IMPACT_AXIAL_N);
    assert.equal(check.transverseLoadN, 0);
    // Sanity band: informative (not a rubber-stamp near-zero, not a hairline
    // pass) — the live computed value at time of writing is ~0.096.
    assert.ok(check.maxUtilization > 0.03 && check.maxUtilization < 0.5,
      `maxUtilization ${check.maxUtilization} outside the expected informative band`);
  });

  it("a much larger axial impact load fails the same mace honestly", () => {
    const mesh = generateMaceMesh({});
    const check = structuralCheck(mesh.beam, {
      totalLength: mesh.meta.totalLength, useCase: "mace-impact", material: "steel-a36",
      axialLoadN: DEFAULT_MACE_IMPACT_AXIAL_N * 20,
    });
    assert.equal(check.ok, false);
    assert.ok(check.maxUtilization > 1);
    assert.ok(check.failingStations.length > 0);
  });

  it("optimizeToPass converges the mace in a single iteration (already passing at default handleRadius — no thickening needed)", async () => {
    const result = await optimizeToPass({}, {
      generate: generateMaceMesh, useCase: "mace-impact", material: "steel-a36",
      thickenParam: "handleRadius", thickenParamDefault: 0.014, maxIters: 12,
    });
    assert.equal(result.ok, true);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].ok, true);
  });
});

describe("staff-swing — combined axial thrust + transverse strike on the haft", () => {
  it("the default staff (untouched STAFF_DEFAULTS.gripRadius) FAILS hard under the combined load — a real, discriminating finding, not tuned to pass", () => {
    const mesh = generateStaffMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "staff-swing", material: "douglas-fir" });
    assert.equal(check.ok, false);
    assert.equal(check.axialLoadN, STAFF_THRUST_AXIAL_N);
    assert.equal(check.transverseLoadN, DEFAULT_STAFF_STRIKE_TRANSVERSE_N);
    assert.ok(check.maxUtilization > 10, `expected a hard fail (>10x over allowable), got ${check.maxUtilization}`);
    assert.ok(check.failingStations.length > 0);
  });

  it("optimizeToPass converges the staff by thickening gripRadius — a real, non-trivial design change, reported not hidden", async () => {
    const result = await optimizeToPass({}, {
      generate: generateStaffMesh, useCase: "staff-swing", material: "douglas-fir",
      thickenParam: "gripRadius", thickenParamDefault: 0.012, maxIters: 12,
    });
    assert.equal(result.ok, true, `expected convergence, got ${JSON.stringify({ reason: result.reason })}`);
    assert.equal(result.check.ok, true);
    assert.ok(result.params.gripRadius > 0.012, "must have thickened the failing dimension");
    // The converged grip radius is meaningfully larger than the original —
    // an honest consequence of the derived 1016N strike load on a 1.4m
    // lever arm, not something to quietly shrink back down.
    assert.ok(result.params.gripRadius / 0.012 > 2,
      `expected a substantial thickening, got ${result.params.gripRadius}`);
    assert.equal(result.history[0].ok, false, "first attempt (unmodified default) must honestly fail before converging");
  });

  it("a lighter transverse-only load (no thrust) still exercises the transverse path independently", () => {
    const mesh = generateStaffMesh({ gripRadius: 0.05 });
    const check = structuralCheck(mesh.beam, {
      totalLength: mesh.meta.totalLength, useCase: "staff-swing", material: "douglas-fir",
      axialLoadN: 0, transverseLoadN: 50,
    });
    assert.equal(check.axialLoadN, 0);
    assert.equal(check.transverseLoadN, 50);
  });
});

describe("shield-face-load — axial compression along the depth axis from a face blow (documented representational limits)", () => {
  it("the default shield PASSES trivially (maxUtilization << 1%) — the honest FINDING that this use case measures the wrong span, not evidence of shield safety", () => {
    const mesh = generateShieldMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "shield-face-load", material: "douglas-fir" });
    assert.equal(check.ok, true);
    assert.equal(check.axialLoadN, DEFAULT_SHIELD_BLOW_AXIAL_N);
    // The load-bearing FINDING: this passes with an enormous margin (well
    // under 1% utilization) for a full committed sword-class blow, because
    // the depth-axis "beam" has a cross-sectional area equal to the entire
    // shield face. This is NOT a meaningful structural safety margin — see
    // fea-gate.js's shield-face-load rationale comment.
    assert.ok(check.maxUtilization < 0.01, `expected a trivial (<1%) utilization demonstrating the finding, got ${check.maxUtilization}`);
    assert.deepEqual(check.failingStations, []);
  });

  it("even an absurdly large blow force (100x the derived default) still passes — quantifying HOW wrong the axial-through-thickness idealization is for this geometry", () => {
    const mesh = generateShieldMesh({});
    const check = structuralCheck(mesh.beam, {
      totalLength: mesh.meta.totalLength, useCase: "shield-face-load", material: "douglas-fir",
      axialLoadN: DEFAULT_SHIELD_BLOW_AXIAL_N * 100,
    });
    assert.equal(check.ok, true, `expected this to STILL pass (demonstrating the finding), got ${JSON.stringify(check)}`);
    assert.ok(check.maxUtilization < 1, `maxUtilization ${check.maxUtilization}`);
  });

  it("the chain reduces to a single member after junction dedupe + zero-area apex exclusion (documented, not a crash)", () => {
    // Directly exercises the geometric pitfall buildFullChainFrameModel's
    // doc-comment describes: the shield's raw beam co-product has a
    // coincident-x junction (plate end == boss start) AND a literal
    // zero-area boss apex (pointEnd) — both must be handled without
    // producing a zero-length member or a crash.
    const mesh = generateShieldMesh({});
    const rawXs = new Set(mesh.beam.stations.map((s) => s.s));
    assert.ok(rawXs.size < mesh.beam.stations.length, "raw beam co-product must contain a coincident-x junction for this test to be meaningful");
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "shield-face-load", material: "douglas-fir" });
    assert.equal(Number.isFinite(check.maxUtilization), true, "must be a real finite number, not NaN/Infinity from a zero-length member");
  });
});

describe("honest failure paths generalize to the chain-kind use cases", () => {
  it("never fabricates a pass on an unknown material for a chain use case", () => {
    const mesh = generateMaceMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "mace-impact", material: "unobtainium-9000" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unknown_material");
  });

  it("never fabricates a pass on a zero/absent load for a chain use case", () => {
    const mesh = generateMaceMesh({});
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength, useCase: "mace-impact", axialLoadN: 0, transverseLoadN: 0 });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "bad_load");
  });

  it("insufficient_chain_stations is reported honestly on a degenerate single-station beam (not a crash)", () => {
    const check = structuralCheck({ stations: [{ s: 0, area: 1e-4, momentOfInertia: 1e-9, approximation: false }] }, {
      totalLength: 1, useCase: "mace-impact",
    });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "insufficient_chain_stations");
  });
});
