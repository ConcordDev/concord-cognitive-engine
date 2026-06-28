// Behavioral macro tests for the voice lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields).
//
// Two real channels reach the four deterministic text calculators
// (transcriptAnalyze / speakerDiarize / sentimentScore / keywordSpot — pure
// text ops, NO LLM, so they are driven directly here):
//   • components/voice/VoiceActionPanel.tsx → callMacro(action, { artifact:
//       { data } }) → apiHelpers.lens.runDomain('voice', action, { input }).
//       body.input === { artifact: { data } } → dispatch peels the redundant
//       artifact wrapper → handler reads artifact.data.* (== params here).
//   • app/lenses/voice/page.tsx inline "Voice Actions" panel →
//       useRunArtifact('voice') → POST /api/lens/voice/:id/run → lens.run
//       resolves the take artifact and dispatches with artifact.data = the
//       take's data (carrying .transcript). Same handler, same return shape.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// components/voice/VoiceActionPanel.tsx + app/lenses/voice/page.tsx after the
// 2026-06-28 alignment fix):
//   - transcriptAnalyze: wordCount / sentenceCount / speakingRate ("N words/min")
//     / fillerWords{} / totalFillers / fillerRate ("N%") / vocabularyRichness
//     (page's inline panel was DEAD: it read wpm / sentences / fillerWords(as a
//     number) / durationSeconds — none of which the handler ever returns)
//   - speakerDiarize: speakerCount / dominantSpeaker / speakers[].{speaker,
//     wordCount, wordShare, talkTimeSeconds}  (page was DEAD: read
//     speakers[].label / .duration / .share — never returned)
//   - sentimentScore: overallScore / overallLabel / sentimentArc /
//     segmentBreakdown{positive,negative,neutral,total}  (page was DEAD: read
//     score / label / confidence — never returned)
//   - keywordSpot: totalOccurrences / keywordDensity ("N%") / topKeywords[].
//     {keyword,count} respecting contextRadius  (page was DEAD: read
//     keywords[].word / .frequency — never returned)
//   - VALIDATION-REJECTION on poisoned/typed-wrong inputs
//   - DEGRADE-GRACEFUL: the four calculators are stateless — they compute even
//     with STATE gone (never throw)
//   - FAIL-CLOSED on poisoned numerics (durationMinutes / contextRadius =
//     NaN / Infinity / "1e999"): {ok:false} with a finite-guard message, never
//     a leaked NaN/Infinity.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVoiceActions from "../domains/voice.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "voice", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read
// artifact.data) and any params-reading macros see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`voice.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "voice", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper VoiceActionPanel.callMacro builds before dispatch:
//   runDomain('voice', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. This proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerVoiceActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "voice_a", id: "voice_a" }, userId: "voice_a" };

// A realistic two-speaker transcript with countable fillers + sentiment words.
const TRANSCRIPT =
  "[Speaker A]: Good morning, I really love this excellent plan. " +
  "Um, we will ship the great release today. " +
  "[Speaker B]: Honestly the budget is a terrible problem and I am worried. " +
  "Basically the timeline is awful, you know.";

/* ───────── registration: every macro the lens channels drive ───────── */

describe("voice lens — registration of the driven calculators", () => {
  it("registers the four deterministic text calculators the surfaces drive", () => {
    for (const m of ["transcriptAnalyze", "speakerDiarize", "sentimentScore", "keywordSpot"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing voice.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("voice lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a transcriptAnalyze call sent the way VoiceActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read defaults
    // (empty transcript) → the 'Provide a transcript' message, not real stats.
    const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: TRANSCRIPT, durationMinutes: 1 });
    assert.equal(r.ok, true);
    assert.ok(r.result.wordCount > 0, "wordCount should be computed, not defaulted");
    assert.ok(!("message" in r.result), "should not return the empty-input message");
  });
});

/* ───── transcriptAnalyze: EXACT rendered fields ───── */

describe("voice.transcriptAnalyze — exact fields the cards render", () => {
  it("computes word/sentence stats + WPM + fillers with the EXACT keys both surfaces read", () => {
    // VoiceActionPanel sends { transcript, durationMinutes }; the page's inline
    // panel renders wordCount / speakingRate / sentenceCount / totalFillers /
    // fillerRate / vocabularyRichness / fillerWords{} — assert each.
    const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: TRANSCRIPT, durationMinutes: 2 });
    assert.equal(r.ok, true);
    const x = r.result;

    // wordCount: real count of whitespace-split tokens.
    const expectWords = TRANSCRIPT.split(/\s+/).filter(Boolean).length;
    assert.equal(x.wordCount, expectWords);

    // sentenceCount: split on .!? — four sentences here.
    assert.equal(typeof x.sentenceCount, "number");
    assert.ok(x.sentenceCount >= 4);

    // speakingRate: "N words/min" string at durationMinutes=2 → round(words/2).
    assert.equal(typeof x.speakingRate, "string");
    assert.equal(x.speakingRate, `${Math.round(expectWords / 2)} words/min`);

    // fillerWords is an OBJECT keyed by filler → count (the page renders
    // Object.entries on it). "um", "basically", "you know", "really" present.
    assert.equal(typeof x.fillerWords, "object");
    assert.ok(!Array.isArray(x.fillerWords));
    assert.equal(x.fillerWords.um, 1);
    assert.equal(x.fillerWords.basically, 1);
    assert.equal(x.fillerWords["you know"], 1);

    // totalFillers is the numeric total the card shows; fillerRate is "N%".
    // "um" + "basically" + "you know" = 3 counted fillers ("really" is not a
    // tracked filler pattern, by design).
    assert.equal(typeof x.totalFillers, "number");
    assert.ok(x.totalFillers >= 3, `totalFillers ${x.totalFillers} >= 3`);
    assert.match(String(x.fillerRate), /%$/);

    // vocabularyRichness is "N%"; complexityRating is a known bucket.
    assert.match(String(x.vocabularyRichness), /%$/);
    assert.ok(["simple", "moderate", "complex"].includes(x.complexityRating));

    // NONE of the stale dead-panel keys exist.
    assert.equal(x.wpm, undefined);
    assert.equal(x.sentences, undefined);
    assert.equal(x.durationSeconds, undefined);
  });

  it("omits WPM gracefully when no durationMinutes is supplied (string guidance, not NaN)", () => {
    const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: TRANSCRIPT });
    assert.equal(r.ok, true);
    assert.match(r.result.speakingRate, /Provide durationMinutes/);
  });

  it("returns the empty-input guidance message on blank transcript", () => {
    const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: "   " });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

/* ───── speakerDiarize: EXACT rendered fields ───── */

describe("voice.speakerDiarize — exact fields the cards render", () => {
  it("parses [Speaker X]: tags into per-speaker turn stats with the EXACT keys", () => {
    // VoiceActionPanel + the page send { transcript } and render speakerCount /
    // dominantSpeaker / speakers[].{speaker, wordCount, wordShare}.
    const r = callViaComponent("speakerDiarize", ctxA, { transcript: TRANSCRIPT });
    assert.equal(r.ok, true);
    const x = r.result;

    assert.equal(typeof x.speakerCount, "number");
    assert.equal(x.speakerCount, 2, "two tagged speakers");
    assert.equal(typeof x.dominantSpeaker, "string");
    assert.ok(x.dominantSpeaker.length > 0);
    assert.equal(typeof x.totalSegments, "number");
    assert.ok(x.totalSegments >= 2);

    assert.ok(Array.isArray(x.speakers));
    const top = x.speakers[0];
    // The card reads s.speaker / s.wordCount / s.wordShare — assert their shape.
    assert.equal(typeof top.speaker, "string");
    assert.equal(typeof top.wordCount, "number");
    assert.equal(typeof top.wordShare, "number");
    assert.equal(typeof top.talkTimeSeconds, "number");
    // wordShare is a percentage 0..100.
    assert.ok(top.wordShare >= 0 && top.wordShare <= 100);
    // shares across speakers sum to ~100.
    const sumShare = x.speakers.reduce((s, p) => s + p.wordShare, 0);
    assert.ok(Math.abs(sumShare - 100) < 1, `wordShare sum ${sumShare} ~ 100`);

    // dead-panel keys must NOT exist.
    assert.equal(top.label, undefined);
    assert.equal(top.duration, undefined);
    assert.equal(top.share, undefined);
  });

  it("drives explicit segments with start/end times into talkTimeSeconds", () => {
    const r = callViaComponent("speakerDiarize", ctxA, {
      segments: [
        { speaker: "Ana", text: "hello there friends", startTime: 0, endTime: 4 },
        { speaker: "Ben", text: "yes indeed", startTime: 4, endTime: 6 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.speakerCount, 2);
    const ana = r.result.speakers.find((s) => s.speaker === "Ana");
    assert.equal(ana.talkTimeSeconds, 4);
  });
});

/* ───── sentimentScore: EXACT rendered fields ───── */

describe("voice.sentimentScore — exact fields the cards render", () => {
  it("scores polarity with the EXACT keys both surfaces read", () => {
    const r = callViaComponent("sentimentScore", ctxA, { transcript: TRANSCRIPT });
    assert.equal(r.ok, true);
    const x = r.result;

    // overallScore in [-1, 1]; overallLabel a known bucket.
    assert.equal(typeof x.overallScore, "number");
    assert.ok(x.overallScore >= -1 && x.overallScore <= 1);
    assert.ok(["positive", "negative", "neutral"].includes(x.overallLabel));
    assert.ok(["improving", "declining", "stable", "insufficient-data"].includes(x.sentimentArc));

    // segmentBreakdown the page renders as +pos / -neg / =neu of total.
    const b = x.segmentBreakdown;
    assert.equal(typeof b.positive, "number");
    assert.equal(typeof b.negative, "number");
    assert.equal(typeof b.neutral, "number");
    assert.equal(b.total, b.positive + b.negative + b.neutral);

    // dead-panel keys must NOT exist.
    assert.equal(x.score, undefined);
    assert.equal(x.label, undefined);
    assert.equal(x.confidence, undefined);
  });

  it("a clearly positive line scores positive; a clearly negative line scores negative", () => {
    const pos = callViaComponent("sentimentScore", ctxA, { transcript: "This is excellent and wonderful, I love it." });
    assert.equal(pos.result.overallLabel, "positive");
    assert.ok(pos.result.overallScore > 0);
    const neg = callViaComponent("sentimentScore", ctxA, { transcript: "This is terrible and awful, I hate the failure." });
    assert.equal(neg.result.overallLabel, "negative");
    assert.ok(neg.result.overallScore < 0);
  });

  it("handles negation (not good → not positive)", () => {
    const r = callViaComponent("sentimentScore", ctxA, { transcript: "This is not good." });
    assert.equal(r.ok, true);
    assert.ok(r.result.overallScore <= 0, "negated 'good' must not read positive");
  });
});

/* ───── keywordSpot: EXACT rendered fields + contextRadius ───── */

describe("voice.keywordSpot — exact fields the cards render", () => {
  it("spots keywords with snippets honoring contextRadius, EXACT keys", () => {
    // VoiceActionPanel sends { transcript, keywords, contextRadius: 50 }; the
    // page renders totalOccurrences / keywordDensity / topKeywords[].{keyword,
    // count}.
    const r = callViaComponent("keywordSpot", ctxA, {
      transcript: TRANSCRIPT,
      keywords: ["release", "budget", "nonexistentword"],
      contextRadius: 50,
    });
    assert.equal(r.ok, true);
    const x = r.result;

    assert.equal(x.keywordsSearched, 3);
    assert.equal(typeof x.totalOccurrences, "number");
    assert.ok(x.totalOccurrences >= 2, "release + budget each appear once");
    assert.match(String(x.keywordDensity), /%$/);

    assert.ok(Array.isArray(x.topKeywords));
    const rel = x.topKeywords.find((k) => k.keyword === "release");
    assert.ok(rel, "release should be a found top keyword");
    assert.equal(typeof rel.keyword, "string");
    assert.equal(rel.count, 1);
    assert.ok(Array.isArray(rel.occurrences));
    // contextRadius governs snippet length around each hit.
    assert.ok(rel.occurrences[0].snippet.length > 0);
    assert.ok(rel.occurrences[0].snippet.length <= "release".length + 2 * 50 + 8);

    // notFound carries the miss.
    assert.ok(x.notFound.includes("nonexistentword"));

    // dead-panel keys must NOT exist on a hit row.
    assert.equal(rel.word, undefined);
    assert.equal(rel.frequency, undefined);
  });

  it("a wider contextRadius yields a longer snippet than a narrow one", () => {
    const narrow = callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: ["budget"], contextRadius: 5 });
    const wide = callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: ["budget"], contextRadius: 60 });
    const ns = narrow.result.topKeywords[0].occurrences[0].snippet;
    const ws = wide.result.topKeywords[0].occurrences[0].snippet;
    assert.ok(ws.length > ns.length, "wider radius → longer context snippet");
  });

  it("returns guidance when no keywords are supplied", () => {
    const r = callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: [] });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

/* ───── validation-rejection ───── */

describe("voice — validation rejection on typed-wrong input", () => {
  it("transcriptAnalyze rejects a non-string transcript", () => {
    const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: { not: "a string" } });
    assert.equal(r.ok, false);
    assert.equal(typeof (r.error || r.message), "string");
  });
  it("keywordSpot rejects a non-string transcript", () => {
    const r = callViaComponent("keywordSpot", ctxA, { transcript: 12345, keywords: ["x"] });
    assert.equal(r.ok, false);
  });
  it("sentimentScore rejects a non-string transcript", () => {
    const r = callViaComponent("sentimentScore", ctxA, { transcript: ["arr"] });
    assert.equal(r.ok, false);
  });
});

/* ───── fail-closed on poisoned numerics ───── */

describe("voice — fail-CLOSED on poisoned numeric inputs (Number.isFinite gate)", () => {
  for (const bad of [NaN, Infinity, -Infinity, "1e999", "Infinity", -3]) {
    it(`transcriptAnalyze rejects durationMinutes=${String(bad)} (no leaked NaN/Infinity)`, () => {
      const r = callViaComponent("transcriptAnalyze", ctxA, { transcript: TRANSCRIPT, durationMinutes: bad });
      assert.equal(r.ok, false, `must reject poisoned durationMinutes=${String(bad)}`);
      // never an {ok:true} carrying a non-finite WPM.
      assert.equal(r.result, undefined);
    });
    it(`keywordSpot rejects contextRadius=${String(bad)} (no leaked NaN/Infinity)`, () => {
      const r = callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: ["release"], contextRadius: bad });
      assert.equal(r.ok, false, `must reject poisoned contextRadius=${String(bad)}`);
      assert.equal(r.result, undefined);
    });
  }
  it("a finite contextRadius still computes (the gate is finite-only, not all-reject)", () => {
    const r = callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: ["release"], contextRadius: 30 });
    assert.equal(r.ok, true);
  });
});

/* ───── degrade-graceful: stateless calculators never throw ───── */

describe("voice — degrade-graceful (stateless calculators compute with STATE gone)", () => {
  beforeEach(() => { delete globalThis._concordSTATE; });
  it("the four calculators still compute when global STATE is unavailable", () => {
    assert.equal(callViaComponent("transcriptAnalyze", ctxA, { transcript: TRANSCRIPT, durationMinutes: 1 }).ok, true);
    assert.equal(callViaComponent("speakerDiarize", ctxA, { transcript: TRANSCRIPT }).ok, true);
    assert.equal(callViaComponent("sentimentScore", ctxA, { transcript: TRANSCRIPT }).ok, true);
    assert.equal(callViaComponent("keywordSpot", ctxA, { transcript: TRANSCRIPT, keywords: ["release"] }).ok, true);
  });
});
