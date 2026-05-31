// The corpus seal & tier rule (LOCKED) — the integrity firewall. Pins the
// canon/conjecture split: a DTU with a checkable machine.verifier is canon
// (safe as an NPC-reasoning premise + discovery); one without is conjecture
// (discoverable but speculation, never a verified premise).
//
// Run: node --test tests/viability/corpus-tier.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tierDtu, isCanon, isConjecture, hasVerifier, tierCorpus } from "../../lib/viability/corpus-tier.js";

const VERIFIER = { kind: "verifier", inputs: ["context"], outputs: ["ok", "violations"], steps: ["parse", "check"] };

describe("tierDtu", () => {
  it("a DTU with a verifier spec is canon", () => {
    assert.equal(tierDtu({ machine: { kind: "rule", verifier: VERIFIER } }), "canon");
    assert.ok(isCanon({ machine: { kind: "formal_model", verifier: VERIFIER } }));
    assert.ok(hasVerifier({ machine: { verifier: { steps: ["x"] } } }));
  });

  it("a DTU without a verifier is conjecture (speculation)", () => {
    assert.equal(tierDtu({ machine: { kind: "first_order" } }), "conjecture"); // first_order carries no verifier
    assert.ok(isConjecture({ machine: { kind: "formal_model" } }));            // unverified model
    assert.ok(isConjecture({}));                                              // malformed → conjecture
    assert.equal(hasVerifier({ machine: { verifier: null } }), false);
  });
});

describe("tierCorpus", () => {
  it("counts canon vs conjecture + a per-kind breakdown", () => {
    const corpus = [
      { id: "a", machine: { kind: "rule", verifier: VERIFIER } },
      { id: "b", machine: { kind: "rule", verifier: VERIFIER } },
      { id: "c", machine: { kind: "first_order" } },          // conjecture
      { id: "d", machine: { kind: "formal_model" } },          // conjecture (no verifier)
      { id: "e", machine: { kind: "formal_model", verifier: VERIFIER } },
    ];
    const t = tierCorpus(corpus);
    assert.equal(t.total, 5);
    assert.equal(t.canon, 3);
    assert.equal(t.conjecture, 2);
    assert.deepEqual(t.byKind.first_order, { canon: 0, conjecture: 1 });
    assert.deepEqual(t.byKind.rule, { canon: 2, conjecture: 0 });
  });

  it("accepts a Map (STATE.dtus) as well as an array", () => {
    const m = new Map([["a", { machine: { kind: "rule", verifier: VERIFIER } }], ["b", { machine: { kind: "first_order" } }]]);
    const t = tierCorpus(m);
    assert.equal(t.canon, 1);
    assert.equal(t.conjecture, 1);
  });
});
