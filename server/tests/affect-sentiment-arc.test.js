// S-AFF-2 pins (build(affect)) — sentiment that reads; the arc computes
// from the mood values on record.
//
// F3: the VAD lexicon matched whole tokens only, so the pass's plainly
// emotional texts ("joyful", "miserable", "exhausted", "hopeless")
// scored Matched 0 — and a zero-match result silently defaulted to a
// constant NEUTRAL 50/50/50 verdict. F4: the Emotion Timeline scored
// check-in NOTE TEXT through that lexicon, so a Great(5) → Awful(1)
// sequence read FLAT 0.000; the Empathy Map reported "None detected"
// over a bottom-scale check-in.
//
// Harness mirrors tests/affect-lens-macros.test.js: handlers invoked as
// (ctx, virtualArtifact{data}, data) with data === artifact.data.
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

describe("S-AFF-2 sentiment: ordinary affect words match", () => {
  it("the pass's positive text scores positive with coverage > 0", () => {
    const r = call("sentimentAnalysis", { text: "I feel joyful and full of energy today." });
    assert.equal(r.ok, true);
    assert.ok(r.result.matchedTokens > 0, `matchedTokens=${r.result.matchedTokens}`);
    assert.ok(r.result.coverage > 0);
    assert.ok(r.result.vad.valence > 0.5, `valence=${r.result.vad.valence}`);
    assert.equal(r.result.sentimentLabel, "positive");
  });

  it("the pass's negative text scores negative, opposite the positive", () => {
    const pos = call("sentimentAnalysis", { text: "I feel joyful and full of energy today." });
    const neg = call("sentimentAnalysis", { text: "I feel miserable and exhausted and hopeless." });
    assert.ok(neg.result.matchedTokens > 0, `matchedTokens=${neg.result.matchedTokens}`);
    assert.ok(neg.result.vad.valence < 0.5, `valence=${neg.result.vad.valence}`);
    assert.equal(neg.result.sentimentLabel, "negative");
    assert.notEqual(neg.result.vad.valence, pos.result.vad.valence);
  });

  it("derived forms match their base entries (sadness, joyfulness)", () => {
    const r = call("sentimentAnalysis", { text: "sadness and joyfulness" });
    assert.ok(r.result.matchedTokens >= 2, `matchedTokens=${r.result.matchedTokens}`);
    const words = (r.result.emotionHits || []).map((h) => h.word);
    assert.ok(words.includes("sadness"), JSON.stringify(words));
    assert.ok(words.includes("joyfulness"), JSON.stringify(words));
  });

  it("zero-match says so — no constant neutral verdict is printed", () => {
    const r = call("sentimentAnalysis", { text: "blorp snizzle wumpus trombone" });
    assert.equal(r.ok, true);
    assert.match(r.result.message || "", /No recognised affect words/);
    assert.equal(r.result.noMatch, true);
    assert.equal(r.result.vad, undefined);
    assert.equal(r.result.sentimentLabel, undefined);
  });
});

describe("S-AFF-2 timeline: the arc computes from mood values", () => {
  it("a Great→Awful mood sequence is not FLAT and carries basis 'mood'", () => {
    const entries = [
      { id: "a", text: "", valence: 1 },
      { id: "b", text: "", valence: 1 },
      { id: "c", text: "", valence: -1 },
      { id: "d", text: "", valence: -1 },
    ];
    const r = call("emotionTimeline", { entries });
    assert.equal(r.ok, true);
    assert.equal(r.result.basis, "mood");
    assert.deepEqual(r.result.timeline.map((t) => t.valence), [1, 1, -1, -1]);
    assert.ok(r.result.smoothedValence.at(-1) < r.result.smoothedValence[0]);
    assert.notEqual(r.result.arcType, "flat");
    assert.ok(r.result.volatility > 0);
  });

  it("text-only entries keep the text score and basis 'text'", () => {
    const entries = [
      { id: "a", text: "happy wonderful day" },
      { id: "b", text: "sad terrible day" },
    ];
    const r = call("emotionTimeline", { entries });
    assert.equal(r.result.basis, "text");
    assert.ok(r.result.timeline[0].valence > 0);
    assert.ok(r.result.timeline[1].valence < 0);
  });

  it("entries with neither mood nor sentiment words stay honestly zero", () => {
    const r = call("emotionTimeline", { entries: [{ id: "a", text: "" }, { id: "b", text: "" }] });
    assert.equal(r.result.basis, "text");
    assert.deepEqual(r.result.timeline.map((t) => t.valence), [0, 0]);
  });
});

describe("S-AFF-2 empathy: scale extremes register without keywords", () => {
  it("a bottom-scale check-in is a pain point even with no note", () => {
    const r = call("empathyMap", { feedback: [{ userId: "self", text: "", moodValence: -1 }] });
    assert.equal(r.result.painPoints.length, 1);
    assert.equal(r.result.painPoints[0].source, "mood");
    assert.equal(r.result.summary.totalPainPoints, 1);
  });

  it("a top-scale check-in is a gain; a neutral one is neither", () => {
    const top = call("empathyMap", { feedback: [{ userId: "self", text: "", moodValence: 1 }] });
    assert.equal(top.result.gains.length, 1);
    assert.equal(top.result.gains[0].source, "mood");
    const mid = call("empathyMap", { feedback: [{ userId: "self", text: "a plain note", moodValence: 0 }] });
    assert.equal(mid.result.painPoints.length, 0);
    assert.equal(mid.result.gains.length, 0);
  });
});
