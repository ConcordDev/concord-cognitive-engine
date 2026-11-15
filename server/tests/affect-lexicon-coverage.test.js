// FIX-affect-004 — the default VAD lexicon missed common feeling words, so
// "I felt steady" scored Matched 0 and returned the no-verdict message. Pin:
// the grounded/settled register words now match and score mildly positive.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerAffectActions from "../domains/affect.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "affect");
  ACTIONS.set(name, fn);
}
function call(name, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`affect.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "affect", type: "domain_action", data, meta: {} };
  return fn({}, virtualArtifact, data);
}

before(() => {
  registerAffectActions(register);
});

describe("FIX-affect-004 — lexicon covers common feeling words", () => {
  it("'I felt steady' matches and scores mildly positive", () => {
    const r = call("sentimentAnalysis", { text: "I felt steady today." });
    assert.equal(r.ok, true);
    assert.ok(r.result.matchedTokens > 0, `matchedTokens=${r.result.matchedTokens}`);
    assert.ok(r.result.vad.valence > 0.5, `valence=${r.result.vad.valence}`);
    assert.equal(r.result.sentimentLabel, "positive");
  });
  it("the settled register matches: grounded, relieved, numb, restless, tense", () => {
    for (const w of ["grounded", "relieved", "numb", "restless", "tense"]) {
      const r = call("sentimentAnalysis", { text: `feeling ${w}` });
      assert.ok(r.result.matchedTokens > 0, `${w} should match`);
    }
  });
});
