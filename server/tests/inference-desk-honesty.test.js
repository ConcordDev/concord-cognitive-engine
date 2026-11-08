// S-INF-2/3 pins for the inference DESK store (server/lib/inference-lens-kb.js):
// negation is parsed, contradictions are flagged, and the status counters
// count what they name (F3/F6 — the status once returned hardcoded zeros).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addSpoFact,
  querySpoFacts,
  getDeskStatus,
  noteDeskOperation,
} from "../lib/inference-lens-kb.js";

const U = "user_desk_honesty";

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("inference desk honesty (S-INF-2/3)", () => {
  it("'is not' is stored as a negated 'is', not as a literal predicate", () => {
    const r = addSpoFact(U, { subject: "door", predicate: "is not", object: "open" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.fact.predicate, "is");
    assert.equal(r.fact.negated, true);
  });

  it("adding the opposite polarity flags the contradiction at entry", () => {
    addSpoFact(U, { subject: "door", predicate: "is", object: "open" });
    const r = addSpoFact(U, { subject: "door", predicate: "is not", object: "open" });
    assert.ok(r.contradiction, "the second add must flag the standing opposite");
    assert.equal(r.contradiction.statement, "door is open");
  });

  it("query results flag contradictions instead of presenting both calmly", () => {
    addSpoFact(U, { subject: "door", predicate: "is", object: "open" });
    addSpoFact(U, { subject: "door", predicate: "is", object: "open", negated: true });
    const q = querySpoFacts(U, { subject: "door" });
    assert.equal(q.found, true);
    assert.ok(Array.isArray(q.contradictions) && q.contradictions.length === 1);
    assert.ok(q.explanation.some((line) => line.startsWith("Contradiction:")));
  });

  it("the desk counters count what they name — status is not hardcoded zeros", () => {
    addSpoFact(U, { subject: "a", predicate: "is", object: "b" });
    querySpoFacts(U, {});
    querySpoFacts(U, {});
    noteDeskOperation(U, "inference");
    noteDeskOperation(U, "derivation", 3);
    const st = getDeskStatus(U);
    assert.equal(st.factCount, 1);
    assert.equal(st.counters.queries, 2);
    assert.equal(st.counters.inferences, 1);
    assert.equal(st.stats.inferencesPerformed, 1);
    assert.equal(st.stats.factsDeduced, 3);
    assert.equal(st.derived, 3);
  });
});
