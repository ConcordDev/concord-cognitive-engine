// server/tests/conkay-orc-requirements.test.js
//
// SX-ORC-02 — orc.requirements acceptance tests.
// Reference case (the catalogue's named case, from the NASA SE Handbook
// doctrine): every requirement has a verifying solver output or is
// flagged. The test asserts the invariant directly against the live
// registry: a requirement's named verifying solver must EXIST
// (getSolver), or the requirement must carry the
// flagged-no-verifying-solver status with a reason. Expected values
// come from the brief text and the declared allocation fractions,
// never from the solver's own echo.
//
// The brief is requirement-parser.js's own documented example:
// "a car that weighs 2,500 lb, does 180 mph, seats 4" ->
// mass <= 1133.98 kg, topSpeed >= 80.47 m/s, seats = 4.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveRequirements, DEFAULT_ALLOCATIONS } from "../lib/conkay/orc/requirements.js";
import { getSolver, listSolvers, envelope } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const BRIEF = "a car that weighs 2,500 lb, does 180 mph, seats 4, futuristic aero look";
const approx = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

describe("SX-ORC-02 — reference case (each requirement verified or flagged)", () => {
  it("extracts the system requirements with SI bounds, given values, and sources", () => {
    const r = deriveRequirements({ text: BRIEF });
    assert.ok(!r.notComputed, r.notComputed);
    const sys = Object.fromEntries(r.outputs.requirements.filter((x) => x.level === "system").map((x) => [x.metric, x]));
    assert.ok(approx(sys.mass.bound.si, 1133.98), `mass si ${sys.mass.bound.si}`);
    assert.equal(sys.mass.bound.kind, "max");
    assert.equal(sys.mass.bound.given, 2500);
    assert.match(sys.mass.source, /2,500 lb/);
    assert.ok(approx(sys.topSpeed.bound.si, 80.47), `topSpeed si ${sys.topSpeed.bound.si}`);
    assert.equal(sys.topSpeed.bound.kind, "min");
    assert.equal(sys.seats.bound.si, 4);
  });

  it("every requirement names an EXISTING verifying solver or is flagged with a reason", () => {
    const r = deriveRequirements({ text: BRIEF });
    for (const req of r.outputs.requirements) {
      if (req.verification.verifyingSolver) {
        assert.ok(getSolver(req.verification.verifyingSolver), `${req.id} names ${req.verification.verifyingSolver}, which is not registered`);
        assert.equal(req.verification.status, "verifiable");
      } else if (req.verification.status === "flagged-no-verifying-solver") {
        assert.ok(req.verification.flagReason, `${req.id} flagged without a reason`);
        assert.ok(r.outputs.flagged.includes(req.id), `${req.id} flagged but absent from outputs.flagged`);
      } else {
        assert.equal(req.verification.status, "verifiable-by-inspection", `${req.id} has an unaccounted verification status`);
      }
      assert.ok(["analysis", "test", "inspection", "demonstration"].includes(req.verification.method));
    }
    // The mass chain is verifiable today (cad.mass-properties-brep is registered).
    const mass = r.outputs.requirements.find((x) => x.id === "REQ-SYS-mass");
    assert.equal(mass.verification.verifyingSolver, "cad.mass-properties-brep");
  });

  it("flows the mass bound down by the declared fractions, each derived requirement sourced to its parent", () => {
    const r = deriveRequirements({ text: BRIEF });
    const subs = r.outputs.requirements.filter((x) => x.level === "subsystem");
    assert.deepEqual(subs.map((x) => x.subsystem), Object.keys(DEFAULT_ALLOCATIONS));
    let total = 0;
    for (const s of subs) {
      assert.equal(s.derivedFrom, "REQ-SYS-mass");
      assert.ok(approx(s.bound.si, 1133.98 * s.allocationFraction, 0.05));
      assert.match(s.source, /declared allocation fraction/);
      total += s.bound.si;
    }
    assert.ok(approx(total, 1133.98, 0.05), "allocations must sum back to the system bound");
    // The defaulted fractions are disclosed as assumptions (SC-03), never silent.
    assert.ok(r.assumptions.length >= 4 && r.assumptions.every((a) => a.kind === "defaulted"));
  });

  it("caller-supplied allocations replace the defaults and are not echoed as defaulted", () => {
    const r = deriveRequirements({ text: BRIEF, allocations: { structure: 0.5, propulsion: 0.5 } });
    const subs = r.outputs.requirements.filter((x) => x.level === "subsystem");
    assert.equal(subs.length, 2);
    assert.equal(r.assumptions.length, 0);
    assert.ok(approx(subs[0].bound.si, 1133.98 * 0.5, 0.05));
  });

  it("part-level flow-down is named as SX-ORC-03's step, not invented here", () => {
    const r = deriveRequirements({ text: BRIEF });
    assert.match(r.outputs.flowDown.partLevel, /SX-ORC-03/);
    assert.ok(!r.outputs.requirements.some((x) => x.level === "part"));
  });
});

describe("SX-ORC-02 — adversarial + honesty legs", () => {
  it("allocations outside (0, 1] or summing over 1 are INVALID_INPUT naming the field", () => {
    const a = deriveRequirements({ text: BRIEF, allocations: { structure: -0.5 } });
    assert.match(a.notComputed, /INVALID_INPUT: allocations\.structure/);
    const b = deriveRequirements({ text: BRIEF, allocations: { structure: 0.7, propulsion: 0.7 } });
    assert.match(b.notComputed, /INVALID_INPUT: allocations sum/);
    const c = deriveRequirements({ text: BRIEF, allocations: { structure: NaN } });
    assert.match(c.notComputed, /INVALID_INPUT: allocations\.structure/);
  });

  it("missing text and target-free text are NOT_COMPUTED, named (SC-05)", async () => {
    await assertNothingAssumed((p) => deriveRequirements(p), { text: BRIEF }, ["text"], "orc.requirements");
    const r = deriveRequirements({ text: "a nice red vehicle for the family" });
    assert.match(r.notComputed, /no_requirements_extracted/);
  });

  it("citations leg: no out-of-domain citations (SC-05 helper)", () => {
    const s = getSolver("orc.requirements");
    const raw = deriveRequirements({ text: BRIEF });
    const env = envelope(s, "B1", raw, { runtimeMs: 1, revision: 0 });
    assertCitationsDomain(env, s, "orc.requirements");
  });
});

describe("SX-ORC-02 — registry + IR reachability", () => {
  it("is registered at L1 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.requirements");
    assert.ok(s, "orc.requirements not in the registry");
    assert.equal(s.fidelity, 1);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === true);
    assert.match(s.reference, /NASA\/SP-2016-6105/);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc2", name: "ORC2" },
      nodes: [
        { id: "B1", kind: "Part", name: "request", props: { "orc.requirements": { text: BRIEF } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.requirements@B1");
    assert.ok(env, "no orc.requirements envelope");
    assert.ok(env.outputs.requirements.some((x) => x.id === "REQ-SYS-mass"));
  });
});
