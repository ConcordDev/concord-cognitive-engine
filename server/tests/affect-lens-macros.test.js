// Phase-2 gate (component↔handler field-alignment) tests for server/domains/affect.js
// — the LENS_ACTIONS (registerLensAction) macros that the /lenses/affect page +
// concord-frontend/components/affect/{MoodTracker,LiveAffectStream} drive through
// /api/lens/run.
//
// DISPATCH SHAPE: these are LENS_ACTIONS handlers invoked as
//   handler(ctx, virtualArtifact, input)   — the 3-ARG convention with
//   virtualArtifact.data === input. The dispatch first PEELS exactly one
//   redundant `{ artifact: { data } }` wrapper (server/lib/lens-input-normalize.js)
//   then passes the SAME object as BOTH artifact.data AND the 3rd param. Our
//   `call()` harness mirrors BOTH steps exactly so a param-position / wrapper-depth
//   regression surfaces here.
//
// SCOPE (no duplication): server/tests/affect-domain-parity.test.js already pins
// the mood-macro streak/correlation/CSV math + per-user scoping. THIS file pins the
// distinct Phase-2 gate signals the parity test does NOT cover:
//   (1) COMPONENT-EXACT field alignment — drive the EXACT inner-data the component
//       sends and assert the EXACT field names it renders from r.result, BOTH
//       directions, so a renamed field on either side (the dead-calculator bug
//       class) fails here instead of rendering a blank panel.
//   (2) VALIDATION-REJECTION — out-of-range / malformed input returns {ok:false}
//       with a string error the component surfaces.
//   (3) DEGRADE-GRACEFUL — empty/absent input returns a stable {ok:true} message
//       (or hasData:false) shape, never a throw.
//   (4) FAIL-CLOSED POISON — a poisoned non-string `text` / non-array `entries` /
//       non-array `feedback` once threw `.trim`/`.map`/non-iterable (a 500, not a
//       graceful degrade). The handlers were hardened to coerce/guard; these tests
//       pin that poison collapses to the empty-input message or {ok:false} and the
//       handler NEVER throws.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAffectActions from "../domains/affect.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "affect", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live /api/lens/run dispatch EXACTLY: peel one redundant artifact
// wrapper, then invoke handler(ctx, virtualArtifact, data) with
// virtualArtifact.data === data === the 3rd param.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`affect.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "affect", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, data);
}

// Mirror the OTHER live path (Analysis-tab `useRunArtifact` → /api/lens/:domain/:id/run):
// the handler receives a REAL artifact whose .data is the bridge-synced snapshot,
// and an empty params object. We exercise it by passing artifact.data directly.
function callArtifact(name, ctx, artifactData = {}, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`affect.${name} not registered`);
  const virtualArtifact = { id: "art_1", domain: "affect", type: "snapshot", data: artifactData, meta: {} };
  return fn(ctx, virtualArtifact, params);
}

before(() => {
  registerAffectActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Network OFF — every macro here is deterministic pure compute / in-memory state.
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "affect_user_a" }, userId: "affect_user_a" };
const ctxB = { actor: { userId: "affect_user_b" }, userId: "affect_user_b" };

// ───────────────────────────────────────────────────────────────────────────
// 1. sentimentAnalysis — Analysis-tab "Sentiment Analysis" panel.
//    Component renders r.result.{sentimentLabel, primaryEmotion, isMixedEmotion,
//    vad.{valence,arousal,dominance}, tokenCount, matchedTokens, coverage,
//    emotionHits[].{word,valence,negated}, sarcasmIndicators[].detail,
//    sarcasmLikelihood}. (page.tsx Sentiment Analysis panel.)
// ───────────────────────────────────────────────────────────────────────────
describe("affect.sentimentAnalysis — VAD scoring", () => {
  it("COMPONENT-EXACT: renders every field the Sentiment panel reads, with real values", () => {
    const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: "I am so happy and grateful today, this is wonderful" } } });
    assert.equal(r.ok, true);
    const res = r.result;
    // Exact field names the panel reads.
    assert.equal(res.sentimentLabel, "positive");
    assert.equal(typeof res.primaryEmotion, "string");
    assert.equal(typeof res.isMixedEmotion, "boolean");
    assert.ok(res.vad && Number.isFinite(res.vad.valence) && Number.isFinite(res.vad.arousal) && Number.isFinite(res.vad.dominance));
    assert.ok(res.vad.valence > 0.6, `expected positive valence, got ${res.vad.valence}`);
    assert.ok(Number.isFinite(res.tokenCount) && res.tokenCount > 0);
    assert.ok(Number.isFinite(res.matchedTokens) && res.matchedTokens >= 3);
    assert.ok(Number.isFinite(res.coverage));
    assert.ok(Array.isArray(res.emotionHits) && res.emotionHits.length >= 3);
    assert.equal(typeof res.emotionHits[0].word, "string");
    assert.equal(typeof res.emotionHits[0].negated, "boolean");
    assert.ok(["low", "moderate", "high"].includes(res.sarcasmLikelihood));
  });

  it("REAL-COMPUTE: negation inverts valence (the panel strikes through negated words)", () => {
    const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: "I am not happy" } } });
    assert.equal(r.ok, true);
    const hit = r.result.emotionHits.find((h) => h.word === "happy");
    assert.ok(hit, "expected a hit for 'happy'");
    assert.equal(hit.negated, true);
    assert.ok(hit.valence < 0.5, `negated 'happy' should drop below 0.5, got ${hit.valence}`);
  });

  it("DEGRADE-GRACEFUL: absent text → {ok:true, result.message} (panel renders message branch)", () => {
    const r = call("sentimentAnalysis", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.ok(!("vad" in r.result));
  });

  it("FAIL-CLOSED POISON: non-string text never throws on .trim()", () => {
    for (const bad of [9999, { x: 1 }, [1, 2], true, Infinity]) {
      const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: bad } } });
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
      assert.equal(typeof r.result.message, "string");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. emotionTimeline — Analysis-tab "Emotion Timeline" panel.
//    Component renders r.result.{arcType, entryCount, volatility, smoothedValence[],
//    arcSegments.{beginning,middle,end}, turningPoints[].{index,type,valence,magnitude},
//    overallValence, overallIntensity}.
// ───────────────────────────────────────────────────────────────────────────
describe("affect.emotionTimeline — emotional arcs", () => {
  const sadToHappy = {
    entries: [
      { id: "e1", text: "everything is terrible awful and I feel miserable despair" },
      { id: "e2", text: "still pretty bad and sad lonely" },
      { id: "e3", text: "things are okay getting better" },
      { id: "e4", text: "I feel good and hopeful now" },
      { id: "e5", text: "wonderful amazing joy great success triumph" },
    ],
  };

  it("COMPONENT-EXACT: renders every field the Timeline panel reads", () => {
    const r = call("emotionTimeline", ctxA, { artifact: { data: sadToHappy } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(typeof res.arcType, "string");
    assert.equal(res.entryCount, 5);
    assert.ok(Number.isFinite(res.volatility));
    assert.ok(Array.isArray(res.smoothedValence) && res.smoothedValence.length === 5);
    assert.ok(res.smoothedValence.every((v) => Number.isFinite(v)));
    assert.ok(res.arcSegments && Number.isFinite(res.arcSegments.beginning) && Number.isFinite(res.arcSegments.middle) && Number.isFinite(res.arcSegments.end));
    assert.ok(Array.isArray(res.turningPoints));
    assert.ok(Number.isFinite(res.overallValence));
    assert.ok(Number.isFinite(res.overallIntensity));
  });

  it("REAL-COMPUTE: a sad→happy progression ends more positive than it begins", () => {
    const r = call("emotionTimeline", ctxA, { artifact: { data: sadToHappy } });
    assert.equal(r.ok, true);
    assert.ok(
      r.result.arcSegments.end > r.result.arcSegments.beginning,
      `expected end (${r.result.arcSegments.end}) > beginning (${r.result.arcSegments.beginning})`,
    );
    assert.ok(["rags-to-riches", "ascending", "man-in-a-hole", "complex"].includes(r.result.arcType));
  });

  it("DEGRADE-GRACEFUL: empty entries → {ok:true, result.message}", () => {
    const r = call("emotionTimeline", ctxA, { artifact: { data: { entries: [] } } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("FAIL-CLOSED POISON: non-array entries never throws on .map()", () => {
    for (const bad of ["a string", 42, { x: 1 }, true]) {
      const r = call("emotionTimeline", ctxA, { artifact: { data: { entries: bad } } });
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
      assert.equal(typeof r.result.message, "string");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. empathyMap — Analysis-tab "Empathy Map" panel.
//    Component renders r.result.{totalFeedback, analyzedAt,
//    quadrants.{thinks,feels,says,does}.{count,items[].text}, painPoints[].{text,keywords},
//    gains[].{text,keywords}, topThemes[].{phrase,count},
//    summary.{totalPainPoints,totalGains,avgPainScore,avgGainScore,sentimentBalance}}.
// ───────────────────────────────────────────────────────────────────────────
describe("affect.empathyMap — Think/Feel/Say/Do quadrants", () => {
  const feedback = {
    feedback: [
      { userId: "u1", text: "I think the new dashboard is confusing and slow to load" },
      { userId: "u2", text: "I feel frustrated when the export breaks, it is a real problem" },
      { userId: "u3", text: "This is so easy and fast, I love how simple it is" },
      { userId: "u4", text: "I clicked buy and the checkout was smooth and helpful" },
    ],
  };

  it("COMPONENT-EXACT: renders every field the Empathy panel reads, with real values", () => {
    const r = call("empathyMap", ctxA, { artifact: { data: feedback } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.totalFeedback, 4);
    assert.equal(typeof res.analyzedAt, "string");
    for (const q of ["thinks", "feels", "says", "does"]) {
      assert.ok(res.quadrants[q] && Number.isFinite(res.quadrants[q].count) && Array.isArray(res.quadrants[q].items), `quadrant ${q}`);
    }
    assert.ok(Array.isArray(res.painPoints) && res.painPoints.length >= 1);
    assert.ok(typeof res.painPoints[0].text === "string" && Array.isArray(res.painPoints[0].keywords));
    assert.ok(Array.isArray(res.gains) && res.gains.length >= 1);
    assert.ok(typeof res.gains[0].text === "string" && Array.isArray(res.gains[0].keywords));
    assert.ok(Array.isArray(res.topThemes));
    const sum = res.summary;
    assert.ok(Number.isFinite(sum.totalPainPoints) && Number.isFinite(sum.totalGains));
    assert.ok(Number.isFinite(sum.avgPainScore) && Number.isFinite(sum.avgGainScore));
    assert.ok(Number.isFinite(sum.sentimentBalance));
  });

  it("REAL-COMPUTE: pain + gain keyword detection populates both lists", () => {
    const r = call("empathyMap", ctxA, { artifact: { data: feedback } });
    assert.equal(r.ok, true);
    assert.ok(r.result.summary.totalPainPoints >= 1, "expected pain points from 'confusing/slow/problem'");
    assert.ok(r.result.summary.totalGains >= 1, "expected gains from 'easy/fast/love/smooth/helpful'");
  });

  it("DEGRADE-GRACEFUL: empty feedback → {ok:true, result.message}", () => {
    const r = call("empathyMap", ctxA, { artifact: { data: { feedback: [] } } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("FAIL-CLOSED POISON: non-array feedback never throws (string iterates chars / object non-iterable)", () => {
    for (const bad of ["a string", 42, { x: 1 }, true]) {
      const r = call("empathyMap", ctxA, { artifact: { data: { feedback: bad } } });
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
      assert.equal(typeof r.result.message, "string");
    }
  });

  it("FAIL-CLOSED POISON: array of poisoned items (null / non-string text) never throws", () => {
    const r = call("empathyMap", ctxA, { artifact: { data: { feedback: [null, { text: 123 }, "raw", { text: "I love this it is great" }] } } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalFeedback));
    // The one well-formed gain item must still register.
    assert.ok(r.result.summary.totalGains >= 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. detect-patterns — Analysis-tab "Pattern Detection" panel.
//    Component renders r.result.{patterns[].{theme,count}, triggers[].{trigger,count},
//    cycles[].{label,count}, correlations[].{between,strength}, summary}.
//    (page.tsx Pattern Detection panel — aligned to these canonical names.)
// ───────────────────────────────────────────────────────────────────────────
describe("affect.detect-patterns — triggers / cycles / themes", () => {
  const journal = {
    entries: [
      { text: "work deadline stress made me anxious", timestamp: "2026-06-01T09:00:00Z" },
      { text: "more work stress and a tight deadline", timestamp: "2026-06-02T09:30:00Z" },
      { text: "family time was happy and calm", timestamp: "2026-06-03T18:00:00Z" },
      { text: "work stress again, anxious about money", timestamp: "2026-06-04T09:15:00Z" },
    ],
  };

  it("COMPONENT-EXACT: patterns[].theme, triggers[].trigger, cycles[].label, correlations[].{between,strength}", () => {
    const r = call("detect-patterns", ctxA, { artifact: { data: journal } });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Array.isArray(res.patterns));
    if (res.patterns.length) {
      assert.equal(typeof res.patterns[0].theme, "string");
      assert.ok(Number.isFinite(res.patterns[0].count));
    }
    assert.ok(Array.isArray(res.triggers) && res.triggers.length >= 1);
    assert.equal(typeof res.triggers[0].trigger, "string");
    assert.ok(Number.isFinite(res.triggers[0].count));
    assert.ok(Array.isArray(res.cycles));
    if (res.cycles.length) {
      assert.equal(typeof res.cycles[0].label, "string");
      assert.ok(Number.isFinite(res.cycles[0].count));
    }
    assert.ok(Array.isArray(res.correlations));
    if (res.correlations.length) {
      assert.ok(Array.isArray(res.correlations[0].between));
      assert.ok(["strong", "moderate"].includes(res.correlations[0].strength));
    }
    assert.equal(typeof res.summary, "string");
  });

  it("REAL-COMPUTE: 'work' and 'stress' surface as triggers", () => {
    const r = call("detect-patterns", ctxA, { artifact: { data: journal } });
    const triggers = r.result.triggers.map((t) => t.trigger);
    assert.ok(triggers.includes("work"), `expected 'work' trigger, got ${triggers.join(",")}`);
    assert.ok(triggers.includes("stress"), `expected 'stress' trigger, got ${triggers.join(",")}`);
  });

  it("DEGRADE-GRACEFUL: empty entries → {ok:true} with stable empty arrays + summary", () => {
    const r = call("detect-patterns", ctxA, { artifact: { data: { entries: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.entryCount, 0);
    assert.deepEqual(r.result.patterns, []);
    assert.deepEqual(r.result.triggers, []);
    assert.equal(typeof r.result.summary, "string");
  });

  it("FAIL-CLOSED POISON: non-array entries never throws", () => {
    for (const bad of ["a string", 42, { x: 1 }, true]) {
      const r = call("detect-patterns", ctxA, { artifact: { data: { entries: bad } } });
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
      assert.equal(r.result.entryCount, 0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Mood macros (MoodTracker.tsx) — Phase-2 gate: field alignment + validation
//    + degrade-graceful (the streak/correlation/CSV math is pinned separately by
//    affect-domain-parity.test.js; here we pin the EXACT rendered field names the
//    MoodTracker reads, both directions).
// ───────────────────────────────────────────────────────────────────────────
describe("affect.checkin — MoodTracker check-in form", () => {
  it("COMPONENT-EXACT: returns entry.{moodEmoji,moodLabel} + currentStreak + longestStreak", () => {
    // MoodTracker sends { mood, note, activities, promptId, promptAnswer }.
    const r = call("checkin", ctxA, { mood: 4, note: "decent", activities: ["walk"], promptId: "prompt_0", promptAnswer: "calm" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.mood, 4);
    assert.equal(typeof r.result.entry.moodLabel, "string");
    assert.equal(typeof r.result.entry.moodEmoji, "string");
    assert.ok(Number.isFinite(r.result.currentStreak));
    assert.ok(Number.isFinite(r.result.longestStreak));
    assert.ok(Number.isFinite(r.result.totalCheckins));
  });

  it("VALIDATION-REJECTION: out-of-range mood → {ok:false, error:string} (MoodTracker reads r.data.error)", () => {
    const r = call("checkin", ctxA, { mood: 99 });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
    assert.match(r.error, /between/);
  });

  it("FAIL-CLOSED POISON: non-numeric mood is rejected, never throws", () => {
    for (const bad of ["NaN", {}, null, undefined, Infinity]) {
      const r = call("checkin", ctxA, { mood: bad });
      assert.equal(r.ok, false, `poison mood ${JSON.stringify(bad)} must be rejected`);
      assert.equal(typeof r.error, "string");
    }
  });
});

describe("affect.getScale / setScale — MoodTracker scale editor", () => {
  it("COMPONENT-EXACT: getScale returns { scale.points[].{value,label,emoji}, isCustom }", () => {
    const r = call("getScale", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.scale.points) && r.result.scale.points.length >= 2);
    assert.equal(typeof r.result.scale.points[0].value, "number");
    assert.equal(typeof r.result.scale.points[0].label, "string");
    assert.equal(typeof r.result.scale.points[0].emoji, "string");
    assert.equal(typeof r.result.isCustom, "boolean");
  });

  it("VALIDATION-REJECTION: a single-point scale → {ok:false, error}", () => {
    const r = call("setScale", ctxA, { points: [{ value: 1, label: "Only" }] });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("VALIDATION-REJECTION: duplicate scale values → {ok:false, error}", () => {
    const r = call("setScale", ctxA, { points: [{ value: 1, label: "A" }, { value: 1, label: "B" }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /unique/);
  });

  it("COMPONENT-EXACT: setScale round-trips a custom scale ({scale, isCustom:true})", () => {
    const r = call("setScale", ctxA, { points: [{ value: 1, label: "Low", emoji: "😔" }, { value: 2, label: "Mid", emoji: "😐" }, { value: 3, label: "High", emoji: "😄" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.isCustom, true);
    assert.equal(r.result.scale.points.length, 3);
    // The custom scale then bounds checkin validation.
    const over = call("checkin", ctxA, { mood: 5 });
    assert.equal(over.ok, false);
  });
});

describe("affect.trends / nudges — degrade-graceful empty states (MoodTracker reads hasData / due)", () => {
  it("trends with no check-ins → {ok:true, result.hasData:false} (MoodTracker empty branch)", () => {
    const r = call("trends", ctxB, { granularity: "week" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
    assert.ok(Array.isArray(r.result.buckets) && Array.isArray(r.result.daily) && Array.isArray(r.result.dayOfWeek));
  });

  it("nudges with no reminders → {ok:true} with empty due[] + reminders[]", () => {
    const r = call("nudges", ctxB, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.due) && r.result.due.length === 0);
    assert.ok(Array.isArray(r.result.reminders));
    assert.equal(typeof r.result.checkedInToday, "boolean");
  });

  it("journalPrompts: deterministic per-day prompt set with {id,text} (MoodTracker prompt chips)", () => {
    const r = call("journalPrompts", ctxA, { count: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.prompts.length, 3);
    assert.equal(typeof r.result.prompts[0].id, "string");
    assert.equal(typeof r.result.prompts[0].text, "string");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Artifact-path dispatch (Analysis tab `useRunArtifact` → /api/lens/:domain/:id/run):
//    the bridge syncs the affect 7D STATE snapshot (numbers) as artifact.data and
//    passes NO text/entries/feedback — so the three analysis macros must degrade to
//    their message branch, exactly what the panel's message-branch renders.
// ───────────────────────────────────────────────────────────────────────────
describe("affect — Analysis-tab artifact path degrades on a state snapshot", () => {
  const snapshot = { v: 0.6, a: 0.5, s: 0.7, c: 0.6, g: 0.5, t: 0.55, f: 0.3 };
  it("sentimentAnalysis over the snapshot → message branch (no text)", () => {
    const r = callArtifact("sentimentAnalysis", ctxA, snapshot, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });
  it("emotionTimeline over the snapshot → message branch (no entries)", () => {
    const r = callArtifact("emotionTimeline", ctxA, snapshot, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });
  it("empathyMap over the snapshot → message branch (no feedback)", () => {
    const r = callArtifact("empathyMap", ctxA, snapshot, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });
  it("detect-patterns over the snapshot → {ok:true} empty patterns + summary", () => {
    const r = callArtifact("detect-patterns", ctxA, snapshot, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.entryCount, 0);
    assert.equal(typeof r.result.summary, "string");
  });
});
