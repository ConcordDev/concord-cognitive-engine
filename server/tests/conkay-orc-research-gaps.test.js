// server/tests/conkay-orc-research-gaps.test.js
//
// SX-ORC-11 — orc.research-gaps acceptance tests.
// Reference case (the catalogue's named case): a missing allowable
// becomes a queue item and the value stays NOT_COMPUTED — no guessed
// value, no estimate, no default wearing a citation's costume. The
// research engine tier (SXE-41) is NOT_COMPUTED in every run; the
// queue formation is what is asserted.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { researchGaps } from "../lib/conkay/orc/research-gaps.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const NEEDS = [
  { property: "allowableStress", gapKind: "missing", forSolver: "struct.beam-bending", unit: "MPa", sourceClass: "textbook", context: { material: "pine" } },
  { property: "fatigueLimit", gapKind: "unsourced", forSolver: "struct.fatigue", unit: "MPa", sourceClass: "datasheet" },
  { property: "surfaceFinish", gapKind: "unreadable", context: { input: "scan-7", reason: "mesh has no material assignment" } },
];

describe("SX-ORC-11 — reference case (missing allowable -> queue item, value NOT_COMPUTED)", () => {
  it("forms the queue with every value NOT_COMPUTED and its reason", () => {
    const r = researchGaps({ needs: NEEDS });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.queueCount, 3);
    const allow = r.outputs.queue[0];
    assert.equal(allow.property, "allowableStress");
    assert.equal(allow.status, "QUEUED");
    assert.equal(allow.engine, "sxe-41");
    assert.equal(allow.valueStatus, "NOT_COMPUTED");
    assert.match(allow.valueReason, /no value is guessed/);
    assert.equal(r.outputs.staysNotComputed, true);
    // The output contains no value-shaped field for the property.
    assert.ok(!("value" in allow) && !("estimate" in allow) && !("defaultValue" in allow));
  });

  it("duplicates dedupe into one item with occurrences counted, reported in warnings", () => {
    const r = researchGaps({ needs: [...NEEDS, NEEDS[0], NEEDS[0]] });
    assert.equal(r.outputs.queueCount, 3);
    assert.equal(r.outputs.queue[0].occurrences, 3);
    assert.equal(r.outputs.deduped, 2);
    assert.ok(r.warnings.some((w) => /deduped/.test(w)));
  });

  it("the same property for a DIFFERENT requester is a separate queue item", () => {
    const r = researchGaps({
      needs: [
        { property: "allowableStress", gapKind: "missing", forSolver: "struct.beam-bending" },
        { property: "allowableStress", gapKind: "missing", forSolver: "struct.column-buckling" },
      ],
    });
    assert.equal(r.outputs.queueCount, 2);
  });
});

describe("SX-ORC-11 — engine honesty + adversarial legs", () => {
  it("every run carries the engine tier NOT_COMPUTED engine_unavailable:sxe-41", () => {
    const r = researchGaps({ needs: NEEDS });
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-41");
  });

  it("malformed needs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => researchGaps(p), { needs: NEEDS }, ["needs"], "orc.research-gaps");
    assert.match(researchGaps({ needs: [{ gapKind: "missing" }] }).notComputed, /needs\[0\]\.property/);
    assert.match(researchGaps({ needs: [{ property: "x", gapKind: "forgotten" }] }).notComputed, /gapKind "forgotten" is not in the vocabulary/);
    assert.match(researchGaps({ needs: [{ property: "x", gapKind: "missing", sourceClass: "blog" }] }).notComputed, /sourceClass "blog" is not in the vocabulary/);
    assert.match(researchGaps({ needs: [] }).notComputed, /missing_input:needs/);
  });

  it("echo + citations legs (SC-05): structured inputs echoed exactly; no out-of-domain citations", () => {
    const r = researchGaps({ needs: NEEDS });
    assert.deepEqual(r.inputs, { needs: NEEDS }, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("orc.research-gaps"), "orc.research-gaps");
  });
});

describe("SX-ORC-11 — registry + IR reachability", () => {
  it("is registered at L1 with declarations and the SXE-41 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "orc.research-gaps");
    assert.ok(s, "orc.research-gaps not in the registry");
    assert.equal(s.fidelity, 1);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("orc.research-gaps").engineDependent, ["sxe-41"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc11", name: "ORC11" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "rig", props: { "orc.researchGaps": { needs: NEEDS } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.research-gaps@A1");
    assert.ok(env, "no orc.research-gaps envelope");
    assert.equal(env.outputs.queueCount, 3);
  });
});
