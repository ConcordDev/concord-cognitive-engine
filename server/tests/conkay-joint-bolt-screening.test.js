// server/tests/conkay-joint-bolt-screening.test.js
//
// Tests for the joint.bolt-screening ADAPTER.
//
// These tests deliberately check two different things:
//
//   1. Physics reach-through. Every capacity in the adapter's answer comes
//      from the registered AISC 360-16 solvers in physics/solvers/
//      bolted-joint.js. The hand-computed expectations below (e.g. the
//      7/8"-equivalent A325 bolt shear capacity) are only reachable if the
//      adapter really calls those solvers — a stubbed or reimplemented
//      physics would not reproduce them.
//
//   2. Honesty. A joint that could not be screened must never read "ok",
//      never disappear from the totals, and must name the solver that
//      blocked it. Those are the assertions that would fail first if
//      someone made the adapter "helpful" by inventing a default.
//
// Test values: M10 A325 bolts (Fu = 600 MPa), A36 plate (Fu = 400 MPa,
// Fy = 250 MPa), 8 mm plate, 30 mm edge distance, 11 mm hole. SI throughout,
// matching bolted-joint.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { boltScreening } from "../lib/conkay/physics/solvers/joint-bolt-screening.js";

// AISC 360-16 §J3.6, φRn = 0.75 · 0.450 · Fu · Ab · planes for an M10
// (d = 0.010 m) A325 bolt in single shear, threads included.
// Hand value: 0.75 · 0.450 · 600e6 · (π·0.010²/4) = 169 646 N.
const A325_FU = 600e6;
const BOLT_D = 0.010;
const EXPECTED_BOLT_SHEAR_PHI_RN = 0.75 * 0.450 * A325_FU * (Math.PI * BOLT_D * BOLT_D / 4);

const A36 = { id: "a36", label: "A36", ultimatePa: 400e6, yieldPa: 250e6 };
const A325 = { id: "astm-a325", label: "A325", ultimatePa: A325_FU };

function bolts(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    diameter: BOLT_D,
    stressArea: 1.57e-4, // M10 tensile stress area, AISC Manual Table 7-2
    material: A325,
  }));
}

function plates(n = 1, thickness = 0.008) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    thickness,
    width: 0.060,
    material: A36,
  }));
}

// Geometry good enough for the three connection checks plus the
// Crawford-Kulak moment distribution (holePattern must be 1:1 with bolts).
function geometry(nBolts, overrides = {}) {
  const span = 0.040;
  return {
    edgeDistance: 0.030,
    holeDiameter: 0.011,
    shearPlanes: 1,
    threadsExcluded: false,
    holePattern: Array.from({ length: nBolts }, (_, i) => ({ x: i * span, y: 0 })),
    ...overrides,
  };
}

function joint(load, { nBolts = 2, geo = null, plateCount = 1, plateThickness = 0.008 } = {}) {
  return {
    id: "hip_pitch",
    load: { axialForceN: 0, momentNm: 0, ...load },
    geometry: geo ?? geometry(nBolts),
    bolts: bolts(nBolts),
    plates: plates(plateCount, plateThickness),
  };
}

describe("joint.bolt-screening", () => {
  it("returns a low utilization and status ok for a lightly loaded joint", () => {
    const res = boltScreening({ joints: [joint({ shearForceN: 2000 })] });

    assert.equal(res.status, "ok");
    assert.equal(res.partial, false);
    assert.equal(res.totals.evaluated, 1);
    assert.equal(res.totals.notComputed, 0);
    assert.deepEqual(res.overUtilizedJoints, []);
    assert.deepEqual(res.partialJoints, []);

    const j = res.joints[0];
    assert.equal(j.id, "hip_pitch");
    assert.equal(j.status, "ok");
    assert.ok(j.governingUtilization > 0);
    assert.ok(j.governingUtilization < 0.2, `expected a light utilization, got ${j.governingUtilization}`);

    // The answer must come from the registered AISC solvers, and the
    // hand-computed §J3.6 capacity must be the one behind it.
    const shear = j.limitStates.find((l) => l.name === "joint.bolt-shear");
    assert.equal(shear.status, "ok");
    const capacityN = shear.envelope.outputs.governingCapacity.value;
    assert.ok(Math.abs(capacityN - EXPECTED_BOLT_SHEAR_PHI_RN) / EXPECTED_BOLT_SHEAR_PHI_RN < 1e-9,
      `expected the AISC §J3.6 capacity ${EXPECTED_BOLT_SHEAR_PHI_RN} N, got ${capacityN} N`);

    // Demand 2000 N shared by 2 bolts = 1000 N/bolt.
    assert.ok(Math.abs(j.governingUtilization - 1000 / EXPECTED_BOLT_SHEAR_PHI_RN) < 1e-12);
  });

  it("fails a heavily loaded joint and lists it in overUtilizedJoints", () => {
    const res = boltScreening({
      joints: [joint({ shearForceN: 60000, momentNm: 2000 })],
    });

    assert.equal(res.status, "fail");
    assert.equal(res.totals.failed, 1);
    assert.deepEqual(res.overUtilizedJoints, ["hip_pitch"]);
    assert.ok(res.joints[0].governingUtilization > 1,
      `expected utilization > 1, got ${res.joints[0].governingUtilization}`);
    assert.equal(res.joints[0].status, "fail");

    // The AISC-scope verdict aggregator agrees: this is a real FAIL, not a
    // screening artifact.
    assert.equal(res.joints[0].verdict.value, "FAIL");
  });

  it("warns (never oks) an incomplete joint spec and names the missing fields", () => {
    const res = boltScreening({
      joints: [
        {
          id: "knee_flex",
          load: { shearForceN: 4000 },
          geometry: { edgeDistance: 0.030 }, // no holeDiameter, no holePattern
          // no bolts, no plates
        },
      ],
    });

    assert.equal(res.partial, true);
    assert.notEqual(res.status, "ok");
    assert.equal(res.status, "warn");
    assert.deepEqual(res.partialJoints, ["knee_flex"]);
    assert.equal(res.totals.evaluated, 0);
    assert.equal(res.totals.notComputed, 1);

    const j = res.joints[0];
    assert.equal(j.status, "not_computed");
    assert.equal(j.governingUtilization, null);
    assert.ok(Array.isArray(j.notComputed.missing) && j.notComputed.missing.length > 0);
    for (const field of ["geometry.holeDiameter", "bolts", "plates"]) {
      assert.ok(j.notComputed.missing.includes(field),
        `expected missing field "${field}", got ${JSON.stringify(j.notComputed.missing)}`);
    }
    // The reason points at the solver that could not run.
    assert.match(j.reason, /joint\.bolt-tearout/);
  });

  it("returns not_computed for an empty joints array", () => {
    for (const input of [{}, { joints: [] }, { joints: "not-an-array" }]) {
      const res = boltScreening(input);
      assert.equal(res.status, "not_computed");
      assert.equal(res.reason, "joints array required");
      assert.equal(res.partial, false);
      assert.deepEqual(res.joints, []);
      assert.deepEqual(res.overUtilizedJoints, []);
      assert.deepEqual(res.partialJoints, []);
      assert.deepEqual(res.totals, { evaluated: 0, failed: 0, warned: 0, notComputed: 0 });
    }
  });

  it("names a limit state it actually evaluated as the governing one", () => {
    const res = boltScreening({ joints: [joint({ shearForceN: 3000, axialForceN: 5000 })] });
    const j = res.joints[0];

    const evaluated = j.limitStates.filter((l) => Number.isFinite(l.utilization));
    assert.ok(evaluated.length >= 4, "expected shear, bearing, tear-out and tension to evaluate");
    const names = evaluated.map((l) => l.name);
    assert.ok(names.includes("joint.bolt-shear"));
    assert.ok(names.includes("joint.bolt-bearing"));
    assert.ok(names.includes("joint.bolt-tearout"));
    assert.ok(names.includes("joint.bolt-tension"), "axial tension must run joint.bolt-tension");
    assert.ok(names.includes("joint.bolt-combined"),
      "shear + tension must prefer the combined interaction check");

    // The governing name is one of the evaluated names, and its utilization
    // is the max of them — not a placeholder.
    assert.ok(names.includes(j.governingLimitState),
      `governingLimitState "${j.governingLimitState}" is not among the evaluated ${JSON.stringify(names)}`);
    const worst = Math.max(...evaluated.map((l) => l.utilization));
    assert.equal(j.governingUtilization, worst);
    assert.equal(j.governingUtilization, evaluated.find((l) => l.name === j.governingLimitState).utilization);
  });

  it("accounts for every input joint in totals.evaluated + totals.notComputed", () => {
    const joints = [
      joint({ shearForceN: 2000 }),
      { id: "broken", load: { shearForceN: 100 }, geometry: {} },
      { ...joint({ shearForceN: 60000 }), id: "shoulder_flex" },
      { id: "no_load", load: {}, geometry: geometry(2), bolts: bolts(2), plates: plates() },
    ];

    const res = boltScreening({ joints });
    assert.equal(res.joints.length, joints.length);
    // Every input joint is accounted for exactly once: an evaluated joint
    // has a finite utilization, an unevaluated one does not.
    assert.equal(res.totals.evaluated + res.totals.notComputed, joints.length);

    // And every joint carries a status, so the totals can be reconciled
    // against the per-joint answers (there is no "ok" bucket in totals —
    // "ok" joints are the remainder of `evaluated`).
    const okCount = res.joints.filter((j) => j.status === "ok").length;
    assert.equal(res.totals.failed + res.totals.warned + okCount + res.totals.notComputed, joints.length);
    assert.ok(res.totals.failed >= 1);
    assert.ok(res.totals.notComputed >= 1);
    assert.deepEqual(res.overUtilizedJoints, ["shoulder_flex"]);
    assert.deepEqual(res.partialJoints.sort(), ["broken", "no_load"]);
    assert.equal(res.status, "fail");
  });

  it("gives different utilizations for identical joints under different loads", () => {
    // Identical geometry, bolts and plates; only the load differs. If the
    // load never reached the AISC solvers the two answers would match.
    const light = joint({ shearForceN: 2000 });
    const heavy = joint({ shearForceN: 20000 });

    const res = boltScreening({ joints: [light, { ...heavy, id: "hip_pitch_heavy" }] });
    const [a, b] = res.joints;

    assert.equal(a.governingLimitState, b.governingLimitState);
    assert.ok(b.governingUtilization > a.governingUtilization * 5,
      `expected the 10x load to raise utilization: ${a.governingUtilization} → ${b.governingUtilization}`);
    // Exactly 10x: the demand is linear and the capacity is unchanged.
    assert.ok(Math.abs(b.governingUtilization / a.governingUtilization - 10) < 1e-9);

    // And the moment reaches the physics too, not just the shear.
    const twisted = boltScreening({ joints: [joint({ shearForceN: 2000, momentNm: 400 })] });
    assert.ok(twisted.joints[0].governingUtilization > res.joints[0].governingUtilization,
      "a joint moment must increase the screened demand");
    assert.equal(twisted.joints[0].screened.momentScreened, true);
    assert.ok(twisted.joints[0].screened.effectiveShearN > res.joints[0].screened.effectiveShearN);
  });

  it("propagates an honest reason naming the solver it could not synthesize, without crashing", () => {
    // A moment with no holePattern cannot be turned into per-bolt demand by
    // joint.bolt-group-distribution. The adapter must surface that solver's
    // own reason and refuse to call the joint ok.
    const res = boltScreening({
      joints: [joint({ shearForceN: 2000, momentNm: 400 }, { geo: geometry(2, { holePattern: undefined }) })],
    });

    const j = res.joints[0];
    const blocked = j.limitStates.find((l) => l.status === "not_computed");
    assert.ok(blocked, "expected a blocked limit state");
    assert.equal(blocked.name, "joint.bolt-group-distribution");
    assert.match(blocked.reason, /joint\.bolt-group-distribution/,
      "the reason must name the solver that blocked it");
    assert.match(blocked.reason, /holePattern/,
      "the reason must carry the upstream solver's own missing-input reason");
    assert.match(blocked.reason, /UNSCREENED/);

    // The remaining limit states still ran, and the joint is still partial.
    assert.ok(j.limitStates.some((l) => l.name === "joint.bolt-shear" && Number.isFinite(l.utilization)));
    assert.equal(res.partial, true);
    assert.equal(res.status, "warn");
    assert.notEqual(j.status, "ok");
    assert.deepEqual(res.partialJoints, ["hip_pitch"]);

    // A completely unusable geometry — Lc <= 0 — must also be reported, not
    // coerced into a plausible-looking capacity.
    const badEdge = boltScreening({
      joints: [joint({ shearForceN: 2000 }, { geo: geometry(2, { edgeDistance: 0.005, holeDiameter: 0.011 }) })],
    });
    const tearout = badEdge.joints[0].limitStates.find((l) => l.name === "joint.bolt-tearout");
    assert.equal(tearout.status, "not_computed");
    assert.match(tearout.reason, /joint\.bolt-tearout/);
    assert.equal(badEdge.partial, true);
    assert.equal(badEdge.joints[0].status, "warn");
  });

  it("reports finite numbers only and honours warnUtilization", () => {
    const res = boltScreening({ joints: [joint({ shearForceN: 60000 })] });
    const walk = (v) => {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `non-finite number in output: ${v}`);
    };
    walk(res.joints[0].governingUtilization);
    for (const l of res.joints[0].limitStates) {
      walk(l.utilization);
      for (const m of l.envelope?.margins || []) walk(m.utilization);
    }

    // Raising the warn threshold downgrades the status of the same joint.
    const warn = boltScreening({ joints: [joint({ shearForceN: 60000 })], warnUtilization: 0.5 });
    assert.equal(res.joints[0].governingUtilization, warn.joints[0].governingUtilization);
    assert.equal(res.joints[0].status, "fail");
    assert.equal(warn.warnUtilization, 0.5);

    // An in-between load lands in the warn band. bolted-joint.js shares the
    // joint shear equally, so the per-bolt utilization is shear/(2·φRn):
    // 1.9·φRn of joint shear gives exactly 0.95 per bolt.
    const perBolt = 1.9 * EXPECTED_BOLT_SHEAR_PHI_RN;
    const mid = boltScreening({ joints: [joint({ shearForceN: perBolt })] });
    assert.ok(Math.abs(mid.joints[0].governingUtilization - 0.95) < 1e-9,
      `expected the shear check to govern at 0.95, got ${mid.joints[0].governingUtilization} (${mid.joints[0].governingLimitState})`);
    assert.equal(mid.joints[0].governingLimitState, "joint.bolt-shear");
    assert.equal(mid.joints[0].status, "warn");
    assert.equal(mid.status, "warn");
    assert.deepEqual(mid.overUtilizedJoints, []);

    // A nonsense warn threshold is refused, not silently coerced.
    const bad = boltScreening({ joints: [joint({ shearForceN: 2000 })], warnUtilization: 0 });
    assert.equal(bad.status, "not_computed");
    assert.match(bad.reason, /warnUtilization/);
  });
});