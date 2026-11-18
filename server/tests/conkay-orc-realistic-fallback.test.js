// server/tests/conkay-orc-realistic-fallback.test.js
//
// SX-ORC-09 — orc.realistic-fallback acceptance tests.
// The catalogue's named reference cases, with expected values
// computed independently of the solver (hand arithmetic from the
// cited bounds, restated in each test):
//   (1) "0-100 km/h in 0.5 s" against the tyre-friction bound
//       a <= mu*g (mu = 1.0 declared, g = 9.80665): the requested
//       acceleration is 55.56 m/s^2; the balanced min-max
//       relaxation moves speed and time by the same relative
//       t = (v - L*t0)/(v + L*t0) = 0.6999290...
//   (2) "1 kg drone carrying 100 kg for 10 h" against a declared
//       mass-closure ratio (payload fraction <= 0.40) and an
//       energy endurance limit from the feasibility envelopes
//       (0.35 kg battery at the 300 Wh/kg ceiling = 105 Wh over
//       cruise power m*g*v/(L/D) = 18.38746875 W at the requested
//       1 kg point -> 20557.4789 s).
// The relaxation rule is the founder's F10 ruling (2026-11-18):
// priorities first, then min-max relative change, min-max first
// plus up to two Pareto alternatives, every change citing its
// forcing envelope, the answer worded "closest within the stated
// envelope" (CB-0835 rule 2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { realisticFallback } from "../lib/conkay/orc/realistic-fallback.js";
import { envelope, getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { rankSolvers } from "../lib/conkay/orc/solver-map.js";
import { assertCitationsDomain } from "./_conkay-honesty.mjs";

const rel = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const ACCEL = {
  requirements: [
    { metric: "speed", bound: { kind: "min", si: 100 / 3.6, unit: "m/s", given: 100 }, source: "0-100 km/h" },
    { metric: "time", bound: { kind: "max", si: 0.5, unit: "s" }, source: "in 0.5 s" },
  ],
  constraints: [
    {
      kind: "ratio", numerator: "speed", denominator: "time",
      bound: { kind: "max", si: 9.80665, unit: "m/s^2" },
      envelope: { solver: "orc.feasibility", citation: "tyre-friction bound a <= mu*g with mu = 1.0 declared (high-grip tyre, dry asphalt) — Gillespie, Fundamentals of Vehicle Dynamics; g = 9.80665 m/s^2" },
    },
  ],
};

const DRONE = {
  requirements: [
    { metric: "totalMass", bound: { kind: "max", si: 1, unit: "kg" }, priority: "must", source: "1 kg drone" },
    { metric: "payload", bound: { kind: "min", si: 100, unit: "kg" }, source: "carrying 100 kg" },
    { metric: "endurance", bound: { kind: "min", si: 36000, unit: "s", given: 10 }, source: "for 10 h" },
  ],
  constraints: [
    {
      kind: "ratio", numerator: "payload", denominator: "totalMass",
      bound: { kind: "max", si: 0.4, unit: "1" },
      envelope: { solver: "orc.mass-bom", citation: "mass closure over the case-declared fractions (structure 0.25 + battery 0.35 of total mass) leaves a payload fraction of at most 0.40" },
    },
    {
      kind: "limit", metric: "endurance",
      bound: { kind: "max", si: 20557.47885363503, unit: "s" },
      envelope: { solver: "orc.feasibility", citation: "energy bound at the requested 1 kg point: 0.35 kg of battery at the 300 Wh/kg specific-energy ceiling = 105 Wh over cruise power m*g*v/(L/D) = 18.38746875 W (v = 15 m/s, L/D = 8, case-declared) — Breguet-electric energy form (Anderson)" },
    },
  ],
};

describe("SX-ORC-09 — reference case 1: 0-100 km/h in 0.5 s vs the tyre-friction bound", () => {
  it("relaxes to the balanced min-max version, fully computed, with both Pareto alternatives", () => {
    const r = realisticFallback(ACCEL);
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.verdict, "relaxed");
    assert.equal(r.outputs.claim, "closest within the stated envelope");
    // Balanced: t = (27.7778 - 4.903325)/(27.7778 + 4.903325) = 0.6999290
    assert.ok(rel(r.outputs.maxRelativeChange, 0.6999290364623729), `maxRel ${r.outputs.maxRelativeChange}`);
    assert.ok(rel(r.outputs.realistic.speed.value, 8.335304542711864), `speed ${r.outputs.realistic.speed.value}`);
    assert.ok(rel(r.outputs.realistic.time.value, 0.8499645182311865), `time ${r.outputs.realistic.time.value}`);
    // The relaxed point sits exactly on the cited bound.
    assert.ok(rel(r.outputs.realistic.speed.value / r.outputs.realistic.time.value, 9.80665, 1e-9));
    // Every change cites the forcing envelope.
    assert.equal(r.outputs.changes.length, 2);
    for (const c of r.outputs.changes) {
      assert.equal(c.forcedBy.length, 1);
      assert.equal(c.forcedBy[0].solver, "orc.feasibility");
      assert.ok(/tyre-friction/.test(c.forcedBy[0].citation));
    }
    // Two Pareto alternatives, each relaxing a different requirement.
    assert.equal(r.outputs.alternatives.length, 2);
    const speedOnly = r.outputs.alternatives.find((a) => a.relaxes.length === 1 && a.relaxes[0] === "speed");
    const timeOnly = r.outputs.alternatives.find((a) => a.relaxes.length === 1 && a.relaxes[0] === "time");
    assert.ok(speedOnly && timeOnly);
    assert.ok(rel(speedOnly.realistic.speed.value, 4.903325), "mu*g * 0.5 s");
    assert.equal(speedOnly.realistic.time.value, 0.5);
    assert.ok(rel(timeOnly.realistic.time.value, 2.832545036049801), "v / (mu*g)");
    assert.equal(timeOnly.realistic.speed.value, 100 / 3.6);
    // Alternatives are feasible against the bound, and worse on min-max.
    for (const a of r.outputs.alternatives) {
      assert.ok(a.realistic.speed.value / a.realistic.time.value <= 9.80665 * (1 + 1e-9));
      assert.ok(a.maxRelativeChange > r.outputs.maxRelativeChange);
    }
  });
});

describe("SX-ORC-09 — reference case 2: the 1 kg drone (priorities first)", () => {
  it("holds the 'must' mass and relaxes payload alone; endurance moves to its energy limit", () => {
    const r = realisticFallback(DRONE);
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.realistic.totalMass.value, 1, "the must is held");
    assert.equal(r.outputs.realistic.payload.value, 0.4, "0.40 x 1 kg exactly");
    assert.ok(rel(r.outputs.realistic.endurance.value, 20557.47885363503, 1e-9));
    assert.ok(rel(r.outputs.maxRelativeChange, 0.996, 1e-9));
    const payloadChange = r.outputs.changes.find((c) => c.metric === "payload");
    assert.equal(payloadChange.forcedBy[0].solver, "orc.mass-bom");
    assert.equal(payloadChange.mustRelaxed, false);
    const enduranceChange = r.outputs.changes.find((c) => c.metric === "endurance");
    assert.equal(enduranceChange.forcedBy[0].solver, "orc.feasibility");
    // Alternatives: the min-max balance (which relaxes the must,
    // flagged) and the mass-only version.
    assert.equal(r.outputs.alternatives.length, 2);
    const balanced = r.outputs.alternatives.find((a) => a.relaxes.length === 2);
    assert.ok(rel(balanced.realistic.payload.value, 0.7968127490039945));
    assert.ok(rel(balanced.realistic.totalMass.value, 1.9920318725099602));
    assert.equal(balanced.changes.find((c) => c.metric === "totalMass").mustRelaxed, true);
    const massOnly = r.outputs.alternatives.find((a) => a.relaxes.length === 1 && a.relaxes[0] === "totalMass");
    assert.equal(massOnly.realistic.totalMass.value, 250);
    assert.equal(massOnly.realistic.payload.value, 100);
  });

  it("without the 'must', the same case leads with the min-max balance (rule 2)", () => {
    const unranked = structuredClone(DRONE);
    delete unranked.requirements[0].priority;
    const r = realisticFallback(unranked);
    assert.ok(rel(r.outputs.realistic.payload.value, 0.7968127490039945));
    assert.ok(rel(r.outputs.realistic.totalMass.value, 1.9920318725099602));
    assert.ok(rel(r.outputs.maxRelativeChange, 0.99203187250996));
  });

  it("a priority stated in the requirement's own source words ranks it too", () => {
    const worded = structuredClone(DRONE);
    delete worded.requirements[0].priority;
    worded.requirements[0].source = "the drone must mass 1 kg";
    const r = realisticFallback(worded);
    assert.equal(r.outputs.realistic.totalMass.value, 1);
    assert.equal(r.outputs.requested.totalMass.priority, "must");
    assert.equal(r.outputs.requested.totalMass.prioritySource, "source-words");
  });
});

describe("SX-ORC-09 — feasible requests and honesty legs", () => {
  it("a feasible request is answered as feasible, with no changes and no invented relaxation", () => {
    const r = realisticFallback({
      requirements: [
        { metric: "mass", bound: { kind: "max", si: 2, unit: "kg" } },
        { metric: "speed", bound: { kind: "min", si: 3, unit: "m/s" } },
      ],
      constraints: [
        { kind: "limit", metric: "mass", bound: { kind: "max", si: 20, unit: "kg" }, envelope: { solver: "orc.requirements", citation: "the brief's own system bound" } },
      ],
    });
    assert.equal(r.outputs.verdict, "feasible-as-requested");
    assert.deepEqual(r.outputs.changes, []);
    assert.equal(r.outputs.maxRelativeChange, 0);
    assert.ok(/feasible as stated/.test(r.outputs.claimText));
  });

  it("the engine tier rides NOT_COMPUTED in every result, never labelled as the answer", () => {
    const r = realisticFallback(ACCEL);
    assert.equal(r.outputs.envelope.engineTier.status, "NOT_COMPUTED");
    assert.ok(/engine_unavailable:sxe-21/.test(r.outputs.envelope.engineTier.reason));
    assert.ok(r.warnings.some((w) => /engine_unavailable:sxe-21/.test(w)));
    const env = envelope(getSolver("orc.realistic-fallback"), "X", r, { runtimeMs: 1, revision: 0 });
    assert.equal(env.status, "WARN");
  });

  it("inputs echo exactly (SC-05) and citations sit in the envelope (SC-05 helper legs)", () => {
    const r = realisticFallback(ACCEL);
    // The shared helper's echo leg reduces via Number() (scalar
    // inputs); for structured inputs the stack's recorded form
    // is an exact deep-equal echo asserted in-suite (B2's SC-05
    // checker note). Both halves are asserted here.
    assert.deepEqual(r.inputs, ACCEL);
    const s = listSolvers().find((x) => x.id === "orc.realistic-fallback");
    const env = envelope(getSolver("orc.realistic-fallback"), "X", r, { runtimeMs: 1, revision: 0 });
    assertCitationsDomain(env, s, "orc.realistic-fallback");
  });
});

describe("SX-ORC-09 — adversarial legs", () => {
  it("missing requirements -> NOT_COMPUTED naming the field", () => {
    assert.ok(/missing_input:requirements/.test(realisticFallback({}).notComputed));
    assert.ok(/missing_input:requirements/.test(realisticFallback({ requirements: [] }).notComputed));
  });

  it("a bare number without a declared unit is refused (SC-04)", () => {
    const r = realisticFallback({ requirements: [{ metric: "mass", bound: { kind: "max", si: 2 } }] });
    assert.ok(/bound\.unit/.test(r.notComputed), r.notComputed);
  });

  it("NaN and 1e300 bounds -> INVALID_INPUT naming the field", () => {
    const nan = realisticFallback({ requirements: [{ metric: "mass", bound: { kind: "max", si: NaN, unit: "kg" } }] });
    assert.ok(/INVALID_INPUT: requirements\[0\]\.bound\.si/.test(nan.notComputed));
    const huge = realisticFallback({ requirements: [{ metric: "mass", bound: { kind: "max", si: 1e300, unit: "kg" } }] });
    assert.ok(/INVALID_INPUT/.test(huge.notComputed));
  });

  it("an uncited constraint cannot force a change", () => {
    const r = realisticFallback({
      requirements: [{ metric: "mass", bound: { kind: "max", si: 2, unit: "kg" } }],
      constraints: [{ kind: "limit", metric: "mass", bound: { kind: "max", si: 1, unit: "kg" }, envelope: { solver: "orc.mass-bom" } }],
    });
    assert.ok(/envelope\.citation/.test(r.notComputed), r.notComputed);
  });

  it("a constraint over an undeclared metric is refused by name", () => {
    const r = realisticFallback({
      requirements: [{ metric: "mass", bound: { kind: "max", si: 2, unit: "kg" } }],
      constraints: [{ kind: "limit", metric: "thrust", bound: { kind: "max", si: 1, unit: "N" }, envelope: { solver: "orc.feasibility", citation: "x" } }],
    });
    assert.ok(/not a declared requirement/.test(r.notComputed));
  });

  it("contradictory envelopes -> NOT_COMPUTED naming both, never an improvised version", () => {
    const r = realisticFallback({
      requirements: [{ metric: "mass", bound: { kind: "max", si: 5, unit: "kg" } }],
      constraints: [
        { kind: "limit", metric: "mass", bound: { kind: "max", si: 1, unit: "kg" }, envelope: { solver: "orc.mass-bom", citation: "closure cap" } },
        { kind: "limit", metric: "mass", bound: { kind: "min", si: 2, unit: "kg" }, envelope: { solver: "orc.feasibility", citation: "energy floor" } },
      ],
    });
    assert.ok(/contradictory_envelopes/.test(r.notComputed), r.notComputed);
  });

  it("a ratio boxed in by limits on every side -> the engine tier is named, no number improvised", () => {
    // Speed may not fall below 10 m/s (a declared minimum
    // operating speed) and time may not grow past 0.6 s (the
    // brief's own cap): the friction bound's cheapest landing
    // (4.903 m/s) and its balanced landing (8.335 m/s in
    // 0.850 s) both cross a limit, on every side.
    const boxed = structuredClone(ACCEL);
    boxed.constraints.push(
      { kind: "limit", metric: "time", bound: { kind: "max", si: 0.6, unit: "s" }, envelope: { solver: "orc.requirements", citation: "the brief's own timing cap" } },
      { kind: "limit", metric: "speed", bound: { kind: "min", si: 10, unit: "m/s" }, envelope: { solver: "orc.feasibility", citation: "a declared minimum operating speed for the drivetrain" } },
    );
    const r = realisticFallback(boxed);
    assert.ok(/engine_tier_required:sxe-21/.test(r.notComputed), r.notComputed);
  });
});

describe("SX-ORC-09 — registry + IR reachability", () => {
  it("is registered at L3 with declarations and the sxe-21 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "orc.realistic-fallback");
    assert.ok(s, "orc.realistic-fallback not in the registry");
    assert.equal(s.fidelity, 3);
    assert.deepEqual(getSolver("orc.realistic-fallback").engineDependent, ["sxe-21"]);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc9", name: "ORC9" },
      nodes: [
        { id: "B1", kind: "Part", name: "request", props: { "orc.realisticFallback": ACCEL } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.realistic-fallback@B1");
    assert.ok(env, "no orc.realistic-fallback envelope");
    assert.equal(env.outputs.verdict, "relaxed");
    assert.equal(env.status, "WARN");
  });

  it("declaration hygiene: the fallback's declared text does not steal the mass-properties match (ORC-05 class)", () => {
    const ranked = rankSolvers("mass properties", listSolvers());
    assert.equal(ranked[0].id, "cad.mass-properties-brep");
    const fb = rankSolvers("closest realistic version of an impossible request", listSolvers());
    assert.equal(fb[0].id, "orc.realistic-fallback");
  });
});
