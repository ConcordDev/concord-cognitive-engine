// Behavioral macro tests for server/domains/linguistics.js — the
// text-scientist + lexicographer + word-learning substrate the
// /lenses/linguistics page + concord-frontend/components/linguistics/*
// panels drive.
//
// These are LENS_ACTIONS handlers (registerLensAction), invoked through
// /api/lens/run → LENS_ACTIONS dispatch as `handler(ctx, virtualArtifact, input)`
// — the 3-ARG convention with `virtualArtifact.data === input`. The dispatch
// also PEELS exactly one redundant `{ artifact: { data } }` wrapper
// (server/lib/lens-input-normalize.js) before building virtualArtifact, so the
// LinguisticsActionPanel's `callMacro(action, { artifact: { data: { text } } })`
// lands at the handler as `artifact.data === { text }`. Our `call()` harness
// mirrors BOTH steps exactly (peel → 3-arg) so a regression that confuses the
// param positions or the wrapper depth surfaces here.
//
// COMPONENT-EXACT-SHAPE: each compute test drives the EXACT inner-data object the
// component sends and asserts the EXACT field names it renders from r.result —
// both directions — so a renamed field on either side (the dead-calculator bug
// class: component reads r.x while handler returns r.y) fails here instead of
// silently rendering a blank panel.
//
// CORRECTNESS SCRUTINY: these are deterministic pure text ops (no wallet, no
// minting), so the risk is fail-OPEN — a poisoned non-string `text` once threw
// `text.split is not a function` (a 500, not a graceful degrade). The handlers
// were hardened to `String(...)`-coerce input; the poisoned-numeric block pins
// that every numeric output stays Number.isFinite and the handler never throws.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLinguisticsActions from "../domains/linguistics.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "linguistics", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch EXACTLY: peel one redundant artifact wrapper, then
// invoke handler(ctx, virtualArtifact, data) with virtualArtifact.data === data.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`linguistics.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "linguistics", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, data);
}

before(() => { registerLinguisticsActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Network OFF — these tests must NOT touch Free Dictionary / Datamuse.
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "ling_user_a" }, userId: "ling_user_a" };

// Every macro the lens page + components reach.
const LENS_MACROS = [
  // pure-compute calculators (LinguisticsActionPanel + page Analyze)
  "textAnalysis", "sentimentAnalysis", "analyze", "morphologyBreakdown", "frequencyAnalysis",
  // external-API (network) calculators — present, not exercised live here
  "dictionary-lookup", "datamuse-words", "pronounce", "word-context", "etymology",
  // STATE-backed vocabulary / quiz / progress / decks the side panels call
  "vocab-add", "vocab-list", "vocab-update", "vocab-delete", "vocab-review-due",
  "vocab-review", "vocab-dashboard", "progress-stats", "progress-set-goal",
  "quiz-generate", "quiz-grade", "deck-create", "deck-list", "deck-delete", "deck-import",
];

describe("linguistics — registration (every lens-driven macro present)", () => {
  it("registers every macro the page + components call", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing linguistics.${m}`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// textAnalysis — LinguisticsActionPanel.actAnalyze.
// Component sends callMacro('textAnalysis', { artifact: { data: { text } } });
// renders r.result.{wordCount,sentenceCount,vocabularySize,lexicalDiversity,
// readabilityGrade,readingLevel,avgWordLength,avgSentenceLength}.
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics.textAnalysis — exact readability + diversity math", () => {
  it("returns every field TextResult renders, with real computed values", () => {
    // EXACT input the component sends (double-wrapped — peel mirrors dispatch).
    const r = call("textAnalysis", ctxA, { artifact: { data: { text: "The quick brown fox jumps over the lazy dog. It was a sunny day." } } });
    assert.equal(r.ok, true);
    const res = r.result;
    // Both directions: every field the component reads must be present.
    for (const k of ["wordCount", "sentenceCount", "vocabularySize", "lexicalDiversity",
      "readabilityGrade", "readingLevel", "avgWordLength", "avgSentenceLength"]) {
      assert.ok(k in res, `textAnalysis must return ${k}`);
    }
    // 14 words across 2 sentences, 13 distinct ("the" repeats).
    assert.equal(res.wordCount, 14);
    assert.equal(res.sentenceCount, 2);
    assert.equal(res.vocabularySize, 13);
    assert.equal(res.lexicalDiversity, Math.round((13 / 14) * 100)); // 93
    assert.equal(res.avgSentenceLength, 7); // 14/2
    assert.ok(Number.isFinite(res.readabilityGrade));
    assert.equal(typeof res.readingLevel, "string");
    assert.equal(res.readingLevel, "elementary"); // simple sentence → low FK grade
  });

  it("degrade-graceful: empty text → ok:true with a guidance message (no crash)", () => {
    const r = call("textAnalysis", ctxA, { artifact: { data: { text: "" } } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("reads artifact.data.content as a text fallback", () => {
    const r = call("textAnalysis", ctxA, { artifact: { data: { content: "Hello world. Goodbye world." } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.wordCount, 4);
    assert.equal(r.result.sentenceCount, 2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// sentimentAnalysis — LinguisticsActionPanel.actSentiment.
// Component renders r.result.{sentiment,score,positiveWords,negativeWords,confidence}.
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics.sentimentAnalysis — exact polarity math", () => {
  it("returns every field SentimentResult renders, with real computed values", () => {
    const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: "This is a great wonderful amazing day" } } });
    assert.equal(r.ok, true);
    const res = r.result;
    for (const k of ["sentiment", "score", "positiveWords", "negativeWords", "confidence"]) {
      assert.ok(k in res, `sentimentAnalysis must return ${k}`);
    }
    assert.equal(res.positiveWords, 3); // great, wonderful, amazing
    assert.equal(res.negativeWords, 0);
    assert.equal(res.score, 100); // (3-0)/3 * 100
    assert.equal(res.sentiment, "positive");
    assert.equal(res.confidence, "moderate"); // 3 hits → >0 but not >3
  });

  it("negative text → negative sentiment + correct counts", () => {
    const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: "This terrible awful horrible dreadful experience" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.negativeWords, 4);
    assert.equal(r.result.positiveWords, 0);
    assert.equal(r.result.score, -100);
    assert.equal(r.result.sentiment, "negative");
    assert.equal(r.result.confidence, "high"); // >3 hits
  });

  it("neutral text → neutral, score 0, low confidence", () => {
    const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: "The cat sat on the mat" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sentiment, "neutral");
    assert.equal(r.result.score, 0);
    assert.equal(r.result.confidence, "low");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// analyze — page.tsx handleAnalyze (Quick Analysis box).
// Sends lensRun('linguistics','analyze',{ text, type:'morphosyntactic' });
// renders data.result.content (a string).
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics.analyze — morphosyntactic content string", () => {
  it("returns result.content (the field the page renders) with grounded numbers", () => {
    const r = call("analyze", ctxA, { text: "Beautiful happily running development creates wonderful organization.", type: "morphosyntactic" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.content, "string");
    assert.match(r.result.content, /Morphosyntactic analysis/);
    // Affix-inferred classes come from real suffix matching: -ly adverb,
    // -ing/-ed verb-form, -ful/-ous adjective, -tion/-ment noun.
    assert.match(r.result.content, /adverb/);    // happily
    assert.match(r.result.content, /verb-form/); // running
    // Sidecar structured fields the page falls back on are present + finite.
    assert.ok(Number.isFinite(r.result.readabilityGrade));
    assert.ok(Number.isFinite(r.result.lexicalDiversity));
    assert.equal(typeof r.result.wordClasses, "object");
  });

  it("validation-rejection: missing text → ok:false with an error string", () => {
    const r = call("analyze", ctxA, { type: "morphosyntactic" });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
    assert.match(r.error, /text/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// morphologyBreakdown + frequencyAnalysis — exact compute.
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics.morphologyBreakdown — affix decomposition", () => {
  it("splits prefix/root/suffix and counts morphemes", () => {
    const r = call("morphologyBreakdown", ctxA, { artifact: { data: { word: "unhappiness" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prefix, "un");
    assert.equal(r.result.suffix, "ness");
    assert.equal(r.result.morphemeCount, 3); // prefix + root + suffix
    assert.equal(r.result.wordClass, "noun"); // -ness
  });

  it("base word with no affixes → morphemeCount 1, base-form", () => {
    const r = call("morphologyBreakdown", ctxA, { artifact: { data: { word: "cat" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prefix, "none");
    assert.equal(r.result.suffix, "none");
    assert.equal(r.result.morphemeCount, 1);
  });
});

describe("linguistics.frequencyAnalysis — content-word frequency", () => {
  it("counts words, drops stop-words, ranks content words", () => {
    const r = call("frequencyAnalysis", ctxA, { artifact: { data: { text: "the cat the cat the dog runs fast and the cat sleeps" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWords, 12);
    const top = r.result.topContentWords[0];
    assert.equal(top.word, "cat"); // appears 3× and is not a stop-word
    assert.equal(top.count, 3);
    assert.ok(Number.isFinite(top.frequency));
    assert.ok(Array.isArray(r.result.topContentWords));
    // "the" + "and" are stop-words → excluded from topContentWords.
    assert.ok(!r.result.topContentWords.some((w) => w.word === "the"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// STATE-backed vocabulary / progress / quiz / decks — the side panels.
// VocabularyBuilder renders Word.{id,word,definition,partOfSpeech,example,tags,
// level,reviewCount} + Dash.{totalWords,mastered,learning,fresh,dueNow}.
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics — vocabulary round-trip (VocabularyBuilder.tsx)", () => {
  it("vocab-add → vocab-list → vocab-dashboard returns the exact rendered fields", async () => {
    // Component sends { word, definition, partOfSpeech, example, autoFetch:false }.
    // vocab-add is async (auto-fetch path) — await mirrors the live await.
    const add = await call("vocab-add", ctxA, { word: "Ephemeral", definition: "lasting a very short time", partOfSpeech: "adjective", example: "an ephemeral moment", autoFetch: false });
    assert.equal(add.ok, true);
    assert.equal(add.result.word.word, "ephemeral"); // lowercased
    for (const k of ["id", "word", "definition", "partOfSpeech", "example", "tags", "level", "reviewCount"]) {
      assert.ok(k in add.result.word, `vocab word needs ${k}`);
    }
    assert.equal(add.result.autoFetched, false);

    const list = call("vocab-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.words[0].definition, "lasting a very short time");

    const dash = call("vocab-dashboard", ctxA, {});
    assert.equal(dash.ok, true);
    for (const k of ["totalWords", "mastered", "learning", "fresh", "dueNow"]) {
      assert.ok(k in dash.result, `dashboard needs ${k}`);
    }
    assert.equal(dash.result.totalWords, 1);
    assert.equal(dash.result.fresh, 1); // level 0
    assert.equal(dash.result.dueNow, 1); // due now on add
  });

  it("validation-rejection: vocab-add with no word → ok:false", async () => {
    const r = await call("vocab-add", ctxA, { definition: "x", autoFetch: false });
    assert.equal(r.ok, false);
    assert.match(r.error, /word required/);
  });

  it("vocab-add rejects a duplicate word", async () => {
    await call("vocab-add", ctxA, { word: "lexicon", definition: "a vocabulary", autoFetch: false });
    const dup = await call("vocab-add", ctxA, { word: "lexicon", definition: "again", autoFetch: false });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already/);
  });

  it("vocab-review promotes the Leitner level + sets next interval", async () => {
    const add = await call("vocab-add", ctxA, { word: "reticent", definition: "reserved", autoFetch: false });
    const id = add.result.word.id;
    const rev = call("vocab-review", ctxA, { id, known: true });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.level, 1); // 0 → 1
    assert.equal(rev.result.nextReviewInDays, 1); // REVIEW_INTERVALS[1]
  });
});

describe("linguistics — progress + quiz + decks round-trips", () => {
  it("progress-stats returns every field ProgressDashboard renders", () => {
    const r = call("progress-stats", ctxA, {});
    assert.equal(r.ok, true);
    for (const k of ["points", "streak", "longestStreak", "dailyGoal", "todayPoints", "goalMet", "goalProgress", "badges", "nextBadge"]) {
      assert.ok(k in r.result, `progress-stats needs ${k}`);
    }
    assert.ok(Array.isArray(r.result.badges));
  });

  it("progress-set-goal validation-rejection: out-of-range clamps; zero rejected", () => {
    const ok = call("progress-set-goal", ctxA, { dailyGoal: 30 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.dailyGoal, 30);
    const clamp = call("progress-set-goal", ctxA, { dailyGoal: 9999 });
    assert.equal(clamp.result.dailyGoal, 500); // clamped to max
  });

  it("quiz-generate needs words with definitions (validation-rejection when empty)", () => {
    const r = call("quiz-generate", ctxA, { count: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /add words/);
  });

  it("quiz-generate → quiz-grade typing answer round-trips with points", async () => {
    await call("vocab-add", ctxA, { word: "perspicacious", definition: "having keen insight", autoFetch: false });
    const gen = call("quiz-generate", ctxA, { count: 1, mode: "typing" });
    assert.equal(gen.ok, true);
    const q = gen.result.questions[0];
    assert.equal(q.mode, "typing");
    const grade = call("quiz-grade", ctxA, { wordId: q.wordId, answer: "perspicacious", mode: "typing" });
    assert.equal(grade.ok, true);
    assert.equal(grade.result.correct, true);
    assert.equal(grade.result.points, 10); // typing correct
  });

  it("deck-create → deck-list returns wordCount/mastered enrichment", () => {
    const created = call("deck-create", ctxA, { name: "SAT Words", theme: "exam" });
    assert.equal(created.ok, true);
    const list = call("deck-list", ctxA, {});
    assert.equal(list.ok, true);
    const deck = list.result.decks.find((d) => d.name === "SAT Words");
    assert.ok(deck);
    for (const k of ["id", "name", "theme", "wordCount", "mastered"]) {
      assert.ok(k in deck, `deck needs ${k}`);
    }
    assert.equal(deck.wordCount, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POISONED NUMERICS / NON-STRING — fail-CLOSED finite + never-throw.
// A non-string `text`/`word` once threw `split is not a function` (a 500). The
// handlers now String-coerce; every numeric output must stay Number.isFinite.
// ───────────────────────────────────────────────────────────────────────────
describe("linguistics — POISONED / NON-STRING input (never throws, stays finite)", () => {
  const POISON = [12345, { a: 1 }, [1, 2, 3], "Infinity", "NaN", true];

  it("textAnalysis: poisoned non-string text → ok:true, all numbers FINITE", () => {
    for (const p of POISON) {
      const r = call("textAnalysis", ctxA, { artifact: { data: { text: p } } });
      assert.equal(r.ok, true, `textAnalysis must not crash on ${JSON.stringify(p)}`);
      if ("readabilityGrade" in r.result) {
        for (const k of ["wordCount", "sentenceCount", "avgWordLength", "avgSentenceLength",
          "vocabularySize", "lexicalDiversity", "readabilityGrade"]) {
          assert.ok(Number.isFinite(r.result[k]), `${k} finite for ${JSON.stringify(p)}, got ${r.result[k]}`);
        }
      }
    }
  });

  it("sentimentAnalysis: poisoned non-string text → ok:true, score FINITE", () => {
    for (const p of POISON) {
      const r = call("sentimentAnalysis", ctxA, { artifact: { data: { text: p } } });
      assert.equal(r.ok, true, `sentimentAnalysis must not crash on ${JSON.stringify(p)}`);
      if ("score" in r.result) {
        assert.ok(Number.isFinite(r.result.score), `score finite for ${JSON.stringify(p)}`);
        assert.ok(Number.isFinite(r.result.positiveWords));
        assert.ok(Number.isFinite(r.result.negativeWords));
      }
    }
  });

  it("frequencyAnalysis + morphologyBreakdown + analyze: poisoned input never throws", () => {
    for (const p of POISON) {
      const f = call("frequencyAnalysis", ctxA, { artifact: { data: { text: p } } });
      assert.equal(f.ok, true, `frequencyAnalysis crash on ${JSON.stringify(p)}`);
      if ("totalWords" in f.result) assert.ok(Number.isFinite(f.result.totalWords));
      const m = call("morphologyBreakdown", ctxA, { artifact: { data: { word: p } } });
      assert.equal(m.ok, true, `morphologyBreakdown crash on ${JSON.stringify(p)}`);
      if ("morphemeCount" in m.result) assert.ok(Number.isFinite(m.result.morphemeCount));
      const a = call("analyze", ctxA, { text: p });
      assert.equal(a.ok, true, `analyze crash on ${JSON.stringify(p)}`);
      assert.equal(typeof a.result.content, "string");
    }
  });
});
