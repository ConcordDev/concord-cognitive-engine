/**
 * Cross-System Multi-Physics CAD — aero-on-structure cross-check.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: the formula-based
 * expectations here (q = 0.5·ρ·v², F_drag = q·Cd·A) are computed by hand
 * from the SAME formula already confirmed live elsewhere in this codebase
 * (server/lib/compute/physics-compute.js's `dragForce` and `windLoad`,
 * server/domains/physics.js's quadratic-drag term) — never a value pasted
 * from the module's own output. The combined-FEA expectations are checked
 * against the real, unmodified fea-solver.js#runFEA via server-
 * authoritative superposition (two real applied loads on the same
 * linear-elastic model), mirroring server/tests/thermal-gate.test.js's own
 * hand-built-cantilever-vs-oracle convention.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { momentOfInertia } from "../lib/compute/physics-compute.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { getMaterial } from "../lib/asset-gen/mass-properties.js";
import {
  checkAeroGate,
  buildAeroLoads,
  dynamicPressurePa,
  memberDragForceN,
  resolveFlowDirection,
  DEFAULT_AIR_DENSITY_KG_M3,
  DEFAULT_CD,
} from "../lib/asset-gen/aero-gate.js";

// ── Shared single-member cantilever fixture ─────────────────────────────
// Identical shape to thermal-gate.test.js's cantilever: node A fixed at
// the origin, node B free at x=L, a plain rectangular section.
const STEEL = getMaterial("steel-a36"); // E=200000 MPa, yield=250 MPa
const L = 0.5; // m
const base = 0.05, height = 0.01; // m
const area = base * height;
const I = momentOfInertia("rectangle", { base, height }).value;
const E_Pa = STEEL.E * 1e6;
const SAFETY_FACTOR = 1.5;
const allowable_Pa = (STEEL.yield * 1e6) / SAFETY_FACTOR;

function singleMemberModel({ mechanicalLoads = [], frontalArea, dragCoeff } = {}) {
  return {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      {
        id: "m1", nodeI: "A", nodeJ: "B",
        area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height,
        ...(frontalArea !== undefined ? { frontalArea } : {}),
        ...(dragCoeff !== undefined ? { dragCoeff } : {}),
      },
    ],
    supports: [{ nodeId: "A", type: "fixed" }],
    loads: mechanicalLoads,
  };
}

describe("dynamicPressurePa — hand-calculable textbook formula", () => {
  it("q = 0.5·ρ·v² matches a hand computation at v=20 m/s, ρ=1.225 (default)", () => {
    const v = 20;
    const expectedQ = 0.5 * 1.225 * 400; // 245 Pa (up to IEEE-754 double rounding of 1.225 itself)
    assert.ok(Math.abs(expectedQ - 245) < 1e-9, `hand calc itself should be 245 Pa, got ${expectedQ}`);
    const got = dynamicPressurePa(v);
    assert.ok(Math.abs(got - expectedQ) < 1e-9, `module output ${got} vs hand-evaluated expression ${expectedQ}`);
    assert.ok(Math.abs(got - 245) < 1e-9, `expected 245 Pa, got ${got}`);
  });

  it("uses DEFAULT_AIR_DENSITY_KG_M3 (1.225 kg/m³, sea level) when airDensity is omitted", () => {
    assert.equal(DEFAULT_AIR_DENSITY_KG_M3, 1.225);
    assert.equal(dynamicPressurePa(10), dynamicPressurePa(10, DEFAULT_AIR_DENSITY_KG_M3));
  });

  it("v=0 gives exactly zero dynamic pressure", () => {
    assert.equal(dynamicPressurePa(0), 0);
  });

  it("honors a custom air density (e.g. a denser fluid or altitude correction)", () => {
    const got = dynamicPressurePa(10, 1.0);
    assert.equal(got, 0.5 * 1.0 * 100);
  });
});

describe("resolveFlowDirection — angle or vector, always normalized", () => {
  it("a radian angle resolves to the unit XY vector", () => {
    const d = resolveFlowDirection(0);
    assert.ok(Math.abs(d.x - 1) < 1e-12 && Math.abs(d.y) < 1e-12 && d.z === 0);
    const d90 = resolveFlowDirection(Math.PI / 2);
    assert.ok(Math.abs(d90.x) < 1e-12 && Math.abs(d90.y - 1) < 1e-12);
  });

  it("a non-unit vector is normalized", () => {
    const d = resolveFlowDirection({ x: 3, y: 4, z: 0 });
    assert.ok(Math.abs(d.x - 0.6) < 1e-12 && Math.abs(d.y - 0.8) < 1e-12);
    const mag = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    assert.ok(Math.abs(mag - 1) < 1e-12);
  });

  it("honestly returns null for a zero-magnitude or malformed direction", () => {
    assert.equal(resolveFlowDirection({ x: 0, y: 0, z: 0 }), null);
    assert.equal(resolveFlowDirection(null), null);
    assert.equal(resolveFlowDirection(NaN), null);
    assert.equal(resolveFlowDirection({ x: NaN, y: 0, z: 0 }), null);
  });
});

describe("memberDragForceN — F = q·Cd·A, hand-calculable", () => {
  it("uses the member's own dragCoeff/frontalArea when present", () => {
    const q = 245; // Pa, from the case above
    const F = memberDragForceN(q, { dragCoeff: 0.9, frontalArea: 0.02 });
    assert.equal(F, 245 * 0.9 * 0.02);
  });

  it("falls back to opts.defaultCd / opts.defaultArea when the member lacks its own", () => {
    const q = 100;
    const F = memberDragForceN(q, {}, { defaultCd: 1.1, defaultArea: 0.05 });
    assert.equal(F, 100 * 1.1 * 0.05);
  });

  it("falls back to DEFAULT_CD (1.2) when neither the member nor opts supplies a Cd", () => {
    assert.equal(DEFAULT_CD, 1.2);
    const q = 50;
    const F = memberDragForceN(q, { frontalArea: 0.1 });
    assert.equal(F, 50 * 1.2 * 0.1);
  });

  it("honestly returns null when no frontal area can be resolved at all (no invented geometry)", () => {
    const F = memberDragForceN(100, {}, {});
    assert.equal(F, null);
  });

  it("q=0 gives exactly zero drag force regardless of Cd/A", () => {
    assert.equal(memberDragForceN(0, { dragCoeff: 2, frontalArea: 5 }), 0);
  });
});

describe("buildAeroLoads — per-member superposable nodal force assembly", () => {
  it("a single-member chain gets F/2 lumped at each end node, in the flow direction", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const q = 245;
    const flowDir = resolveFlowDirection({ x: 0, y: 1, z: 0 }); // wind blowing in +Y
    const { nodalLoads, dragForceByMember } = buildAeroLoads(model.nodes, model.members, q, flowDir);
    const expectedF = q * 1.0 * 0.02;
    assert.equal(dragForceByMember.m1, expectedF);

    const atA = nodalLoads.find((l) => String(l.nodeId) === "A");
    const atB = nodalLoads.find((l) => String(l.nodeId) === "B");
    assert.ok(Math.abs(atA.Fy - expectedF / 2) < 1e-9);
    assert.ok(Math.abs(atB.Fy - expectedF / 2) < 1e-9);
    assert.ok(Math.abs(atA.Fx) < 1e-12 && Math.abs(atB.Fx) < 1e-12);
  });

  it("flags a member with no resolvable frontal area in missingAreaMembers instead of fabricating zero", () => {
    const model = singleMemberModel(); // no frontalArea, no dragCoeff
    const flowDir = resolveFlowDirection(0);
    const { missingAreaMembers } = buildAeroLoads(model.nodes, model.members, 245, flowDir, {});
    assert.deepEqual(missingAreaMembers, ["m1"]);
  });

  it("q=0 produces an all-zero assembled load list — the honest degrade case", () => {
    const model = singleMemberModel({ frontalArea: 0.02 });
    const flowDir = resolveFlowDirection(0);
    const { nodalLoads, dragForceByMember } = buildAeroLoads(model.nodes, model.members, 0, flowDir);
    assert.equal(dragForceByMember.m1, 0);
    for (const l of nodalLoads) {
      assert.equal(l.Fx, 0);
      assert.equal(l.Fy, 0);
      assert.equal(l.Fz, 0);
    }
  });
});

describe("checkAeroGate — real combined solver output, honestly labeled", () => {
  it("dynamic pressure in the returned result matches the hand computation exactly (v=20, ρ=1.225 default)", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.ok !== undefined, true);
    assert.ok(Math.abs(check.dynamicPressurePa - 245) < 1e-9, `expected hand-computed q=245 Pa, solver module returned ${check.dynamicPressurePa}`);
  });

  it("aero-only run (no mechanical load) produces a real transverse solver deflection consistent with hand-superposed nodal loads", () => {
    const model = singleMemberModel({ mechanicalLoads: [], frontalArea: 0.02, dragCoeff: 1.0 });
    const velocity = 20;
    const direction = { x: 0, y: 1, z: 0 };
    const check = checkAeroGate(model, { velocity, direction });
    assert.equal(typeof check.combinedUtilization, "number");

    const q = dynamicPressurePa(velocity); // 245 Pa, hand-verified above
    const F = q * 1.0 * 0.02; // hand: 245 * 0.02 = 4.9 N
    assert.ok(Math.abs(F - 4.9) < 1e-9, `hand drag force should be 4.9 N, got ${F}`);

    // Cross-check against a hand-built direct runFEA call with the
    // equivalent F/2-at-each-end loads applied manually — proving
    // aero-gate.js's assembly is not doing anything the real solver
    // wouldn't do on its own.
    const manual = runFEA({
      nodes: model.nodes,
      members: model.members,
      loads: [
        { nodeId: "A", Fy: F / 2 },
        { nodeId: "B", Fy: F / 2 },
      ],
      supports: model.supports,
    });
    assert.ok(Math.abs(manual.summary.maxUtilization - check.combinedUtilization) < 1e-9,
      `solver combinedUtilization ${check.combinedUtilization} vs hand-superposed manual solve ${manual.summary.maxUtilization}`);
  });

  it("velocity=0 degrades EXACTLY to the mechanical-only case — a genuine self-consistency property", () => {
    const P = 200; // N transverse tip load
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: P }], frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 0, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.dynamicPressurePa, 0);
    assert.equal(check.dragForceByMember.m1, 0);
    assert.equal(check.combinedUtilization, check.mechanicalOnlyUtilization,
      `combined ${check.combinedUtilization} must equal mechanical-only ${check.mechanicalOnlyUtilization} at v=0`);
    assert.deepEqual(check.combined.stresses, check.mechanical.stresses);
  });

  it("combined utilization is genuinely higher than mechanical-only when a real wind load is added", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 5 }], frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 30, direction: { x: 0, y: 1, z: 0 } });
    assert.ok(check.combinedUtilization > check.mechanicalOnlyUtilization,
      `combined ${check.combinedUtilization} should exceed mechanical-only ${check.mechanicalOnlyUtilization}`);
  });

  it("mechanicalOnlyUtilization matches a direct runFEA call with only the mechanical loads (no aero-gate involvement at all)", () => {
    const P = 200;
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: P }], frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 1, z: 0 } });
    const direct = runFEA({ nodes: model.nodes, members: model.members, loads: model.loads, supports: model.supports });
    assert.equal(check.mechanicalOnlyUtilization, direct.summary.maxUtilization);
  });

  it("accepts a caller-supplied uniform defaultArea/defaultCd for members with no aero fields of their own", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }] }); // no frontalArea/dragCoeff on the member
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 1, z: 0 }, defaultArea: 0.02, defaultCd: 1.0 });
    assert.equal(typeof check.combinedUtilization, "number");
    assert.equal(check.dragForceByMember.m1, 245 * 1.0 * 0.02);
  });

  it("carries an honest approximationCaveat string on every successful result", () => {
    const model = singleMemberModel({ mechanicalLoads: [{ nodeId: "B", Fy: 200 }], frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(typeof check.approximationCaveat, "string");
    assert.ok(check.approximationCaveat.length > 0);
    assert.ok(/wake|turbulence|interference/i.test(check.approximationCaveat),
      "caveat should honestly name what is NOT modeled");
  });

  // ── Honest failures — never fabricate a pass ──────────────────────────
  it("honestly fails on a negative velocity", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: -5, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "invalid_velocity");
  });

  it("honestly fails on a non-finite velocity", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: NaN, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "invalid_velocity");
  });

  it("honestly fails on a missing/malformed flow direction", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 0, z: 0 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "invalid_flow_direction");
  });

  it("honestly fails on a bad model (no members)", () => {
    const check = checkAeroGate({ nodes: [{ id: "A", x: 0, y: 0, z: 0 }], members: [] }, { velocity: 20 });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "bad_model_input");
  });

  it("honestly fails on a model with no supports", () => {
    const model = singleMemberModel({ frontalArea: 0.02, dragCoeff: 1.0 });
    const noSupports = { ...model, supports: [] };
    const check = checkAeroGate(noSupports, { velocity: 20, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "missing_supports");
  });

  it("honestly fails on a member with no resolvable frontal area (never invents member geometry)", () => {
    const model = singleMemberModel(); // no frontalArea, no dragCoeff, no defaultArea supplied
    const check = checkAeroGate(model, { velocity: 20, direction: { x: 0, y: 1, z: 0 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "missing_aero_properties");
    assert.deepEqual(check.memberIds, ["m1"]);
  });
});
