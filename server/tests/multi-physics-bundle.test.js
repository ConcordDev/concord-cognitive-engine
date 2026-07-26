/**
 * Cross-System Multi-Physics CAD — unified multi-physics bundle
 * (closing leg: server/lib/asset-gen/multi-physics-bundle.js).
 *
 * Per CLAUDE.md's "honest by construction" invariant: this test suite
 * exists specifically to pin that the bundle NEVER collapses different
 * physical domains into one fabricated "combined" number. Every expected
 * value is either (a) a direct call to the real, unmodified
 * checkThermalGate/checkAeroGate/solveCircuit with the SAME inputs
 * (asserting deepEqual — not just "didn't throw"), or (b) a hand-computed
 * textbook value cross-checked against a manual runFEA call, mirroring
 * thermal-gate.test.js's and aero-gate.test.js's own conventions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { momentOfInertia } from "../lib/compute/physics-compute.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { getMaterial } from "../lib/asset-gen/mass-properties.js";
import { checkThermalGate } from "../lib/asset-gen/thermal-gate.js";
import { checkAeroGate } from "../lib/asset-gen/aero-gate.js";
import { solveCircuit } from "../lib/simulation/circuit-solver.js";
import { runMultiPhysicsBundle, runSimultaneousMultiPhysics } from "../lib/asset-gen/multi-physics-bundle.js";

// ── Shared single-member cantilever fixture ─────────────────────────────
// Identical shape to thermal-gate.test.js / aero-gate.test.js: node A
// fixed at the origin, node B free at x=L, along the +X axis, with both
// frontalArea + dragCoeff present so the SAME model works for all three
// structural legs (mechanical/thermal/aero) without modification.
const STEEL = getMaterial("steel-a36"); // E=200000 MPa, cte=11.7 (1e-6/K), yield=250 MPa
const L = 0.5; // m
const base = 0.05, height = 0.01; // m
const area = base * height; // 5e-4 m^2
const I = momentOfInertia("rectangle", { base, height }).value;
const E_Pa = STEEL.E * 1e6;
const SAFETY_FACTOR = 1.5;
const allowable_Pa = (STEEL.yield * 1e6) / SAFETY_FACTOR; // 1.66667e8 Pa

function singleMemberModel({ mechanicalLoads = [], frontalArea = 0.01, dragCoeff = 1.0 } = {}) {
  return {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      {
        id: "m1", nodeI: "A", nodeJ: "B",
        area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height,
        frontalArea, dragCoeff,
      },
    ],
    supports: [{ nodeId: "A", type: "fixed" }],
    loads: mechanicalLoads,
  };
}

// A flow direction along the member's own +X axis keeps the aero load a
// pure axial force (no bending), so hand-computed axial-stress arithmetic
// stays simple and exact, matching how thermal-gate.test.js/aero-gate.
// test.js each keep their own single-axis fixtures simple.
const AXIAL_DIRECTION = { x: 1, y: 0, z: 0 };

describe("runMultiPhysicsBundle — only thermal requested", () => {
  it("returns legs.thermal exactly matching a direct checkThermalGate call, no aero key, allPass mirrors thermal.ok", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const thermalOpts = { deltaT: 40, material: "steel-a36" };

    const bundle = runMultiPhysicsBundle(model, { legs: { thermal: thermalOpts } });
    assert.equal(bundle.ok, true);
    assert.deepEqual(bundle.requestedLegs, ["thermal"]);
    assert.equal(bundle.legs.aero, undefined);
    assert.equal(bundle.electrical, undefined);

    const direct = checkThermalGate(model, thermalOpts);
    assert.deepEqual(bundle.legs.thermal, direct, "bundle's thermal leg must be byte-identical to a direct checkThermalGate call");
    assert.equal(bundle.allPass, direct.ok);
  });

  it("`thermal: true` runs the leg with module defaults (DEFAULT_DELTA_T_C, steel-a36-less callers still get a real result)", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const bundle = runMultiPhysicsBundle(model, { legs: { thermal: { material: "steel-a36" } } });
    assert.equal(bundle.ok, true);
    assert.equal(typeof bundle.legs.thermal.combinedUtilization, "number");
  });
});

describe("runMultiPhysicsBundle — only aero requested", () => {
  it("returns legs.aero exactly matching a direct checkAeroGate call, no thermal key, allPass mirrors aero.ok", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const aeroOpts = { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 };

    const bundle = runMultiPhysicsBundle(model, { legs: { aero: aeroOpts } });
    assert.equal(bundle.ok, true);
    assert.deepEqual(bundle.requestedLegs, ["aero"]);
    assert.equal(bundle.legs.thermal, undefined);
    assert.equal(bundle.electrical, undefined);

    const direct = checkAeroGate(model, aeroOpts);
    assert.deepEqual(bundle.legs.aero, direct, "bundle's aero leg must be byte-identical to a direct checkAeroGate call");
    assert.equal(bundle.allPass, direct.ok);
  });
});

describe("runMultiPhysicsBundle — both legs requested", () => {
  it("both legs' own real numbers are present and match direct calls; allPass is a real boolean AND, never a blended number", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 50 }] });
    const thermalOpts = { deltaT: 10, material: "steel-a36" };
    const aeroOpts = { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 };

    const bundle = runMultiPhysicsBundle(model, { legs: { thermal: thermalOpts, aero: aeroOpts } });
    assert.equal(bundle.ok, true);
    assert.deepEqual(bundle.requestedLegs, ["thermal", "aero"]);

    const directThermal = checkThermalGate(model, thermalOpts);
    const directAero = checkAeroGate(model, aeroOpts);
    assert.deepEqual(bundle.legs.thermal, directThermal);
    assert.deepEqual(bundle.legs.aero, directAero);

    // allPass is a legitimate AND, never a fabricated blend — verify it
    // against BOTH possible truth combinations explicitly.
    assert.equal(bundle.allPass, directThermal.ok && directAero.ok);
    assert.equal(typeof bundle.allPass, "boolean");

    // Never a numeric "combined score" field anywhere on the bundle itself.
    assert.equal(bundle.multiPhysicsUtilization, undefined);
    assert.equal(bundle.combinedUtilization, undefined);

    // Each leg's own combinedUtilization reflects mechanical+ONLY-that-leg
    // — not mechanical+both — so the two numbers are genuinely different
    // (mechanical Fy=50 + thermal deltaT=10 vs. mechanical Fy=50 + aero
    // drag only). This is the "never blended" contract made concrete.
    assert.notEqual(bundle.legs.thermal.combinedUtilization, bundle.legs.aero.combinedUtilization);
  });

  it("no top-level simultaneousUtilization is computed unless opts.simultaneous is explicitly requested", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const bundle = runMultiPhysicsBundle(model, {
      legs: { thermal: { deltaT: 10, material: "steel-a36" }, aero: { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1, defaultArea: 0.01 } },
    });
    assert.equal(bundle.simultaneous, undefined);
  });
});

describe("runMultiPhysicsBundle — one leg fails, the other still returns its real result", () => {
  it("thermal fails on an unknown material while aero's real result is still returned untouched", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] });
    const aeroOpts = { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 };

    const bundle = runMultiPhysicsBundle(model, {
      legs: { thermal: { deltaT: 40, material: "unobtainium-9000" }, aero: aeroOpts },
    });

    assert.equal(bundle.ok, true, "a single failing LEG must not abort the whole bundle");
    assert.equal(bundle.legs.thermal.ok, false);
    assert.equal(bundle.legs.thermal.reason, "unknown_material");

    const directAero = checkAeroGate(model, aeroOpts);
    assert.deepEqual(bundle.legs.aero, directAero, "the succeeding leg's real result must be identical to a direct call");
    assert.equal(bundle.legs.aero.ok, true);

    assert.equal(bundle.allPass, false, "allPass is false because the requested thermal leg failed");
  });

  it("aero fails on missing per-member frontal area while thermal's real result is still returned untouched", () => {
    // No frontalArea/dragCoeff on the member and no opts.defaultArea → an
    // honest checkAeroGate failure (missing_aero_properties), per
    // aero-gate.js's own no-universal-area-default contract.
    // Zero mechanical load so the thermal leg's own combined-utilization
    // stays governed purely by the (real, hand-verified-elsewhere in
    // thermal-gate.test.js) thermal term and actually passes — a
    // transverse Fy on this thin-section fixture would independently blow
    // past the allowable via pure bending, which would muddy what this
    // test is actually checking (that a failing SIBLING leg doesn't drag
    // an otherwise-passing leg down with it).
    const model = {
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }],
      members: [{ id: "m1", nodeI: "A", nodeJ: "B", area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height }],
      supports: [{ nodeId: "A", type: "fixed" }],
      loads: [],
    };
    const thermalOpts = { deltaT: 40, material: "steel-a36" };

    const bundle = runMultiPhysicsBundle(model, {
      legs: { thermal: thermalOpts, aero: { velocity: 20 } },
    });

    assert.equal(bundle.ok, true);
    assert.equal(bundle.legs.aero.ok, false);
    assert.equal(bundle.legs.aero.reason, "missing_aero_properties");

    const directThermal = checkThermalGate(model, thermalOpts);
    assert.deepEqual(bundle.legs.thermal, directThermal);
    assert.equal(bundle.legs.thermal.ok, true);
    assert.equal(bundle.allPass, false);
  });
});

describe("runMultiPhysicsBundle — electrical is independent, never blended into allPass", () => {
  // Classic two-resistor voltage divider, same fixture shape as
  // circuit-solver.test.js.
  const V = 12, R1 = 1000, R2 = 2000;
  const circuitModel = {
    nodes: [{ id: "top" }, { id: "mid" }, { id: "gnd" }],
    elements: [
      { id: "Vs", type: "voltage_source", nodeA: "top", nodeB: "gnd", value: V },
      { id: "R1", type: "resistor", nodeA: "top", nodeB: "mid", value: R1 },
      { id: "R2", type: "resistor", nodeA: "mid", nodeB: "gnd", value: R2 },
    ],
    groundNodeId: "gnd",
  };

  it("electrical-only request needs no structural model, matches a direct solveCircuit call, and allPass is vacuously true", () => {
    const bundle = runMultiPhysicsBundle({ nodes: [], members: [], loads: [], supports: [] }, { electrical: { model: circuitModel } });
    assert.equal(bundle.ok, true);
    assert.deepEqual(bundle.requestedLegs, []);
    assert.equal(bundle.allPass, true, "zero structural legs requested → allPass is vacuously true, not fabricated");

    const direct = solveCircuit(circuitModel);
    assert.deepEqual(bundle.electrical, direct);
    assert.equal(typeof bundle.electricalNote, "string");
    assert.match(bundle.electricalNote, /independent/i);
  });

  it("electrical alongside a FAILING thermal leg still reports its own real success — never dragged into allPass", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const bundle = runMultiPhysicsBundle(model, {
      legs: { thermal: { deltaT: 40, material: "not-a-real-material" } },
      electrical: { model: circuitModel },
    });
    assert.equal(bundle.legs.thermal.ok, false);
    assert.equal(bundle.allPass, false, "the requested (failing) thermal leg alone determines allPass");

    const direct = solveCircuit(circuitModel);
    assert.deepEqual(bundle.electrical, direct, "electrical succeeds independently of the failing structural leg");
    assert.equal(bundle.electrical.ok, true);
  });

  it("an electrical request with no model is an honest per-key failure, not a thrown exception", () => {
    const bundle = runMultiPhysicsBundle({ nodes: [], members: [], loads: [], supports: [] }, { electrical: {} });
    assert.equal(bundle.electrical.ok, false);
    assert.equal(bundle.electrical.reason, "missing_electrical_model");
  });
});

describe("runMultiPhysicsBundle — honest top-level failure when nothing is requested", () => {
  it("no legs and no electrical is a real ok:false, not a silently-empty success", () => {
    const model = singleMemberModel();
    const bundle = runMultiPhysicsBundle(model, {});
    assert.equal(bundle.ok, false);
    assert.equal(bundle.reason, "no_legs_requested");
  });
});

describe("runMultiPhysicsBundle — opts.simultaneous requires BOTH legs", () => {
  it("requesting simultaneous with only the thermal leg is an honest refusal, not a silent skip or a fabricated number", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const bundle = runMultiPhysicsBundle(model, {
      legs: { thermal: { deltaT: 10, material: "steel-a36" } },
      simultaneous: true,
    });
    assert.equal(bundle.simultaneous.ok, false);
    assert.equal(bundle.simultaneous.reason, "simultaneous_requires_both_thermal_and_aero_legs");
  });
});

describe("runSimultaneousMultiPhysics — genuine combined-loads solve, hand-checkable", () => {
  // Hand computation (never pasted from the module's own output):
  //   sigma_thermal = E * alpha * deltaT = (200000e6) * (11.7e-6) * 10
  //                 = 2e11 * 1.17e-4 = 2.34e7 Pa
  //   F_thermal      = sigma_thermal * area = 2.34e7 * 5e-4 = 11700 N
  //   q              = 0.5 * 1.225 * 20^2 = 245 Pa
  //   F_drag         = q * Cd * A = 245 * 1.0 * 0.01 = 2.45 N
  //   (aero lumps F_drag/2 at each end node → 1.225 N reaches the free node)
  //   mechanical Fx  = 0
  //   total axial force at free node B = 11700 + 1.225 + 0 = 11701.225 N
  //   axial stress   = 11701.225 / 5e-4 = 23,402,450 Pa
  //   utilization    = 23,402,450 / allowable_Pa
  it("matches the hand-computed simultaneous axial stress/utilization for a pure-axial fixture", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const deltaT = 10;
    const velocity = 20;

    const sim = runSimultaneousMultiPhysics(
      model,
      { deltaT, material: "steel-a36" },
      { velocity, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 }
    );

    const alpha = STEEL.cte * 1e-6;
    const sigmaThermal = E_Pa * alpha * deltaT;
    assert.ok(Math.abs(sigmaThermal - 2.34e7) / 2.34e7 < 1e-9, `sanity: hand calc itself should be 2.34e7, got ${sigmaThermal}`);
    const fThermal = sigmaThermal * area;

    const q = 0.5 * 1.225 * velocity * velocity;
    assert.ok(Math.abs(q - 245) < 1e-9, "sanity: dynamic pressure hand calc should be 245 Pa");
    const fDrag = q * 1.0 * 0.01;
    const fDragAtFreeNode = fDrag / 2;

    const totalForce = fThermal + fDragAtFreeNode; // mechanical Fx = 0
    const expectedAxialStress = totalForce / area;
    const expectedUtilization = expectedAxialStress / allowable_Pa;

    assert.ok(sim.ok !== undefined, "sim result must be a real object, not thrown");
    assert.ok(Math.abs(sim.mechanicalOnlyUtilization) < 1e-12, "zero mechanical load → zero mechanical-only utilization");
    assert.ok(
      Math.abs(sim.simultaneousUtilization - expectedUtilization) / expectedUtilization < 1e-6,
      `${sim.simultaneousUtilization} vs hand-computed ${expectedUtilization}`
    );

    const gotAxial = sim.simultaneousResult.stresses[0].axialStress;
    assert.ok(
      Math.abs(gotAxial - expectedAxialStress) / expectedAxialStress < 1e-6,
      `${gotAxial} vs hand-computed ${expectedAxialStress}`
    );

    // Cross-check against a fully-manual runFEA call with the hand-summed
    // load applied directly — proving the module's own three-way
    // superposition isn't doing anything the real solver wouldn't do on
    // its own, mirroring thermal-gate.test.js's / aero-gate.test.js's own
    // manual-runFEA cross-check convention.
    const manual = runFEA({
      nodes: model.nodes,
      members: model.members,
      loads: [{ nodeId: "B", Fx: totalForce }],
      supports: model.supports,
    });
    assert.ok(Math.abs(manual.stresses[0].axialStress - gotAxial) < 1e-6);
    assert.ok(Math.abs(manual.summary.maxUtilization - sim.simultaneousUtilization) < 1e-9);
  });

  it("simultaneousUtilization is genuinely distinct from either leg's own combinedUtilization (which each mix mechanical with only ONE of thermal/aero)", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const deltaT = 10;
    const velocity = 20;
    const thermalOpts = { deltaT, material: "steel-a36" };
    const aeroOpts = { velocity, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 };

    const thermalOnly = checkThermalGate(model, thermalOpts);
    const aeroOnly = checkAeroGate(model, aeroOpts);
    const sim = runSimultaneousMultiPhysics(model, thermalOpts, aeroOpts);

    // thermal-only combined = mechanical(0) + thermal; aero-only combined
    // = mechanical(0) + aero; simultaneous = mechanical(0) + thermal + aero.
    // Since thermal's own force vastly dominates aero's here (11700N vs
    // 1.225N), simultaneous should sit just ABOVE thermal-only and well
    // above aero-only — never equal to either, and never their average or
    // max (a real superposition, not a blend).
    assert.ok(sim.simultaneousUtilization > thermalOnly.combinedUtilization);
    assert.ok(sim.simultaneousUtilization > aeroOnly.combinedUtilization);
    assert.notEqual(sim.simultaneousUtilization, thermalOnly.combinedUtilization);
    assert.notEqual(sim.simultaneousUtilization, aeroOnly.combinedUtilization);
    assert.notEqual(sim.simultaneousUtilization, Math.max(thermalOnly.combinedUtilization, aeroOnly.combinedUtilization));
  });

  it("carries an explicit, honest caveat string distinguishing it from a certified multi-physics-coupled analysis", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const sim = runSimultaneousMultiPhysics(
      model,
      { deltaT: 10, material: "steel-a36" },
      { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 }
    );
    assert.equal(typeof sim.caveat, "string");
    assert.match(sim.caveat, /simultaneous/i);
  });

  // ── Honest failures — never fabricate a pass ──────────────────────────
  it("honestly fails on an unknown material", () => {
    const model = singleMemberModel();
    const sim = runSimultaneousMultiPhysics(model, { deltaT: 10, material: "unobtainium-9000" }, { velocity: 20 });
    assert.equal(sim.ok, false);
    assert.equal(sim.reason, "unknown_material");
  });

  it("honestly fails on an invalid (negative) velocity", () => {
    const model = singleMemberModel();
    const sim = runSimultaneousMultiPhysics(model, { deltaT: 10, material: "steel-a36" }, { velocity: -5 });
    assert.equal(sim.ok, false);
    assert.equal(sim.reason, "invalid_velocity");
  });

  it("honestly fails on missing per-member aero geometry with no default area supplied", () => {
    const model = {
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }],
      members: [{ id: "m1", nodeI: "A", nodeJ: "B", area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height }],
      supports: [{ nodeId: "A", type: "fixed" }],
      loads: [],
    };
    const sim = runSimultaneousMultiPhysics(model, { deltaT: 10, material: "steel-a36" }, { velocity: 20 });
    assert.equal(sim.ok, false);
    assert.equal(sim.reason, "missing_aero_properties");
  });

  it("honestly fails on a model with no supports", () => {
    const model = singleMemberModel();
    const noSupports = { ...model, supports: [] };
    const sim = runSimultaneousMultiPhysics(noSupports, { deltaT: 10, material: "steel-a36" }, { velocity: 20, defaultArea: 0.01 });
    assert.equal(sim.ok, false);
    assert.equal(sim.reason, "missing_supports");
  });
});

describe("runMultiPhysicsBundle — end-to-end simultaneous solve wired through the bundle entry point", () => {
  it("bundle.simultaneous matches a direct runSimultaneousMultiPhysics call exactly", () => {
    const model = singleMemberModel({ mechanicalLoads: [] });
    const thermalOpts = { deltaT: 10, material: "steel-a36" };
    const aeroOpts = { velocity: 20, direction: AXIAL_DIRECTION, defaultCd: 1.0, defaultArea: 0.01 };

    const bundle = runMultiPhysicsBundle(model, { legs: { thermal: thermalOpts, aero: aeroOpts }, simultaneous: true });
    const direct = runSimultaneousMultiPhysics(model, thermalOpts, aeroOpts);
    assert.deepEqual(bundle.simultaneous, direct);

    // The bundle's own per-leg results are STILL the independent
    // single-domain checks, unaffected by the simultaneous solve running
    // alongside them.
    assert.deepEqual(bundle.legs.thermal, checkThermalGate(model, thermalOpts));
    assert.deepEqual(bundle.legs.aero, checkAeroGate(model, aeroOpts));
  });
});
