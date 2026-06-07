// tests/depth/linguistics-behavior.test.js — REAL behavioral tests for the
// deterministic (pure-compute + STATE-backed) linguistics lens-actions. The
// fetch-backed surfaces (dictionary-lookup, datamuse-words, pronounce,
// word-context, etymology, autoFetch paths) are deliberately NOT exercised here
// — they require network egress and are skipped by the no-egress harness.
//
// The `linguistics.analyze` macro has its own file (linguistics-analyze-behavior).
// This file covers the rest: textAnalysis, morphologyBreakdown, frequencyAnalysis,
// sentimentAnalysis, plus the STATE-backed vocab/progress/quiz/deck CRUD.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("linguistics.textAnalysis — readability + token stats", () => {
  it("computes exact token/sentence/char/lexical-diversity values", async () => {
    const text = "The cat sat. The dog ran fast.";
    const r = await lensRun("linguistics", "textAnalysis", { data: { text } });
    assert.equal(r.ok, true);
    assert.equal(r.result.wordCount, 7);
    assert.equal(r.result.sentenceCount, 2);
    assert.equal(r.result.charCount, 24);
    assert.equal(r.result.avgWordLength, 3.4);
    assert.equal(r.result.avgSentenceLength, 3.5);
    assert.equal(r.result.vocabularySize, 6); // "the" lowercased dedupes
    assert.equal(r.result.lexicalDiversity, 86); // round(6/7*100)
    assert.ok(["elementary", "middle-school", "high-school", "college"].includes(r.result.readingLevel));
  });

  it("reads from artifact.data.content as well as .text", async () => {
    const r = await lensRun("linguistics", "textAnalysis", { data: { content: "One two three four five." } });
    assert.equal(r.ok, true);
    assert.equal(r.result.wordCount, 5);
    assert.equal(r.result.sentenceCount, 1);
  });

  it("returns a prompt message (not an analysis) when no text supplied", async () => {
    const r = await lensRun("linguistics", "textAnalysis", { data: {} });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Provide text/);
    assert.equal(r.result.wordCount, undefined);
  });
});

describe("linguistics.morphologyBreakdown — prefix/root/suffix split", () => {
  it("decomposes 'unhappiness' into un- + happi + -ness (3 morphemes)", async () => {
    const r = await lensRun("linguistics", "morphologyBreakdown", { data: { word: "unhappiness" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prefix, "un");
    assert.equal(r.result.suffix, "ness");
    assert.equal(r.result.root, "happi");
    assert.equal(r.result.morphemeCount, 3);
    assert.equal(r.result.wordClass, "noun"); // -ness → noun
  });

  it("classes a -ly suffix as adverb with no prefix", async () => {
    const r = await lensRun("linguistics", "morphologyBreakdown", { data: { word: "quickly" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prefix, "none");
    assert.equal(r.result.suffix, "ly");
    assert.equal(r.result.wordClass, "adverb");
    assert.equal(r.result.morphemeCount, 2);
  });
});

describe("linguistics.frequencyAnalysis — counts + stopword filter + hapax", () => {
  it("ranks content words, excludes stopwords, counts hapax legomena", async () => {
    const text = "cat dog cat dog cat bird the the the";
    const r = await lensRun("linguistics", "frequencyAnalysis", { data: { text } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWords, 9);
    assert.equal(r.result.uniqueWords, 4); // cat dog bird the
    assert.equal(r.result.hapaxLegomena, 1); // bird
    // "the" is a stopword → excluded from topContentWords; cat is the top.
    assert.equal(r.result.topContentWords[0].word, "cat");
    assert.equal(r.result.topContentWords[0].count, 3);
    assert.ok(r.result.topContentWords.some((e) => e.word === "bird"));
    assert.ok(!r.result.topContentWords.some((e) => e.word === "the"));
  });
});

describe("linguistics.sentimentAnalysis — polarity scoring", () => {
  it("scores all-positive text as positive with high confidence", async () => {
    // 4 positive hits → (pos+neg) === 4 > 3 → "high" confidence.
    const r = await lensRun("linguistics", "sentimentAnalysis", { data: { text: "This is great and wonderful and amazing and perfect." } });
    assert.equal(r.ok, true);
    assert.equal(r.result.positiveWords, 4);
    assert.equal(r.result.negativeWords, 0);
    assert.equal(r.result.score, 100); // (4-0)/4 * 100
    assert.equal(r.result.sentiment, "positive");
    assert.equal(r.result.confidence, "high"); // (4+0) > 3
  });

  it("scores text with exactly 3 polarity hits as moderate confidence", async () => {
    const r = await lensRun("linguistics", "sentimentAnalysis", { data: { text: "This is great and wonderful and amazing." } });
    assert.equal(r.ok, true);
    assert.equal(r.result.positiveWords, 3);
    assert.equal(r.result.negativeWords, 0);
    assert.equal(r.result.confidence, "moderate"); // (3+0) not > 3
  });

  it("scores a mixed/balanced text as neutral", async () => {
    const r = await lensRun("linguistics", "sentimentAnalysis", { data: { text: "It was good but also bad." } });
    assert.equal(r.ok, true);
    assert.equal(r.result.positiveWords, 1);
    assert.equal(r.result.negativeWords, 1);
    assert.equal(r.result.score, 0);
    assert.equal(r.result.sentiment, "neutral");
  });
});

describe("linguistics.vocab — add / list / review-due / review round-trip", () => {
  it("adds a word (no autoFetch), lists it, reviews it through Leitner promotion", async () => {
    const ctx = await depthCtx("depth:ling-vocab-A");
    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: "ephemeral", definition: "lasting a short time", autoFetch: false } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.word.word, "ephemeral");
    assert.equal(add.result.word.level, 0);
    const id = add.result.word.id;

    // Duplicate add is rejected.
    const dup = await lensRun("linguistics", "vocab-add",
      { params: { word: "ephemeral", definition: "x", autoFetch: false } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(String(dup.result.error), /already in your vocabulary/);

    // It lists.
    const list = await lensRun("linguistics", "vocab-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.words.some((w) => w.id === id));

    // Fresh (level 0, due now) word shows up as due.
    const due = await lensRun("linguistics", "vocab-review-due", { params: {} }, ctx);
    assert.ok(due.result.words.some((w) => w.id === id), "fresh word is due");

    // A "known" review promotes level 0 → 1 with a 1-day interval.
    const rev = await lensRun("linguistics", "vocab-review", { params: { id, known: true } }, ctx);
    assert.equal(rev.ok, true);
    assert.equal(rev.result.level, 1);
    assert.equal(rev.result.nextReviewInDays, 1); // REVIEW_INTERVALS[1]
  });

  it("rejects vocab-add with no word and vocab-review on an unknown id", async () => {
    const ctx = await depthCtx("depth:ling-vocab-B");
    const noWord = await lensRun("linguistics", "vocab-add", { params: { autoFetch: false } }, ctx);
    assert.equal(noWord.result.ok, false);
    assert.match(String(noWord.result.error), /word required/);

    const noId = await lensRun("linguistics", "vocab-review", { params: { id: "missing", known: true } }, ctx);
    assert.equal(noId.result.ok, false);
    assert.match(String(noId.result.error), /word not found/);
  });

  it("dashboard tallies fresh/learning/mastered correctly", async () => {
    const ctx = await depthCtx("depth:ling-vocab-C");
    const a = await lensRun("linguistics", "vocab-add", { params: { word: "lucid", definition: "clear", autoFetch: false } }, ctx);
    const b = await lensRun("linguistics", "vocab-add", { params: { word: "opaque", definition: "not clear", autoFetch: false } }, ctx);
    // Promote one word to level 1 (learning).
    await lensRun("linguistics", "vocab-review", { params: { id: a.result.word.id, known: true } }, ctx);
    const dash = await lensRun("linguistics", "vocab-dashboard", { params: {} }, ctx);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.totalWords, 2);
    assert.equal(dash.result.learning, 1); // lucid at level 1
    assert.equal(dash.result.fresh, 1);    // opaque at level 0
    assert.equal(dash.result.mastered, 0);
    void b;
  });
});

describe("linguistics.progress — points/streak/goal/badges", () => {
  it("awards points on review activity and reflects them in progress-stats", async () => {
    const ctx = await depthCtx("depth:ling-prog-A");
    await lensRun("linguistics", "vocab-add", { params: { word: "sonder", definition: "x", autoFetch: false } }, ctx)
      .then((r) => lensRun("linguistics", "vocab-review", { params: { id: r.result.word.id, known: true } }, ctx));
    const stats = await lensRun("linguistics", "progress-stats", { params: {} }, ctx);
    assert.equal(stats.ok, true);
    assert.equal(stats.result.points, 5); // a "known" review awards 5
    assert.equal(stats.result.streak, 1);
    assert.equal(stats.result.todayPoints, 5);
    assert.equal(stats.result.dailyGoal, 20);
    // nextBadge is "novice" at 50 pts → 45 needed.
    assert.equal(stats.result.nextBadge.id, "novice");
    assert.equal(stats.result.nextBadge.pointsNeeded, 45);
  });

  it("progress-set-goal clamps to 5-500 and round-trips into stats", async () => {
    const ctx = await depthCtx("depth:ling-prog-B");
    const hi = await lensRun("linguistics", "progress-set-goal", { params: { dailyGoal: 9999 } }, ctx);
    assert.equal(hi.ok, true);
    assert.equal(hi.result.dailyGoal, 500); // clamped to max
    const lo = await lensRun("linguistics", "progress-set-goal", { params: { dailyGoal: 1 } }, ctx);
    assert.equal(lo.result.dailyGoal, 5); // clamped to min
    const stats = await lensRun("linguistics", "progress-stats", { params: {} }, ctx);
    assert.equal(stats.result.dailyGoal, 5);
  });
});

describe("linguistics.quiz — generate + grade", () => {
  it("rejects quiz-generate with no defined words, then grades a typing answer", async () => {
    const ctx = await depthCtx("depth:ling-quiz-A");
    const empty = await lensRun("linguistics", "quiz-generate", { params: {} }, ctx);
    assert.equal(empty.result.ok, false);
    assert.match(String(empty.result.error), /add words with definitions/);

    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: "verdant", definition: "green with vegetation", autoFetch: false } }, ctx);
    const gen = await lensRun("linguistics", "quiz-generate", { params: { count: 3 } }, ctx);
    assert.equal(gen.ok, true);
    assert.equal(gen.result.poolSize, 1);
    assert.ok(gen.result.questions.length >= 1);

    // Grade a correct typing answer → level 0→1, 10 points (typing worth more).
    const grade = await lensRun("linguistics", "quiz-grade",
      { params: { wordId: add.result.word.id, mode: "typing", answer: "verdant" } }, ctx);
    assert.equal(grade.ok, true);
    assert.equal(grade.result.correct, true);
    assert.equal(grade.result.level, 1);
    assert.equal(grade.result.points, 10);
    assert.equal(grade.result.correctAnswer, "verdant");
  });

  it("grades a wrong typing answer as incorrect, resetting level to 0", async () => {
    const ctx = await depthCtx("depth:ling-quiz-B");
    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: "umbra", definition: "the darkest shadow", autoFetch: false } }, ctx);
    // Promote first so we can see the reset.
    await lensRun("linguistics", "quiz-grade",
      { params: { wordId: add.result.word.id, mode: "typing", answer: "umbra" } }, ctx);
    const wrong = await lensRun("linguistics", "quiz-grade",
      { params: { wordId: add.result.word.id, mode: "typing", answer: "penumbra" } }, ctx);
    assert.equal(wrong.result.correct, false);
    assert.equal(wrong.result.level, 0); // reset on miss
    assert.equal(wrong.result.points, 1); // wrong answer floor
  });
});

describe("linguistics.vocab — update / delete", () => {
  it("updates definition/example/tags in place and reflects them on re-list", async () => {
    const ctx = await depthCtx("depth:ling-upd-A");
    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: "nadir", definition: "lowest point", autoFetch: false } }, ctx);
    const id = add.result.word.id;

    const upd = await lensRun("linguistics", "vocab-update",
      { params: { id, definition: "the lowest point of a celestial body", example: "the nadir of his career", tags: ["Astro", "exam"] } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.word.definition, "the lowest point of a celestial body");
    assert.equal(upd.result.word.example, "the nadir of his career");
    assert.deepEqual(upd.result.word.tags, ["astro", "exam"]); // lowercased

    // Tag filter on vocab-list finds it by the new tag.
    const byTag = await lensRun("linguistics", "vocab-list", { params: { tag: "astro" } }, ctx);
    assert.ok(byTag.result.words.some((w) => w.id === id), "found by updated tag");

    // Query filter matches the new definition substring.
    const byQuery = await lensRun("linguistics", "vocab-list", { params: { query: "celestial" } }, ctx);
    assert.ok(byQuery.result.words.some((w) => w.id === id), "found by definition substring");
  });

  it("rejects vocab-update on an unknown id, and vocab-delete removes a real word", async () => {
    const ctx = await depthCtx("depth:ling-del-A");
    const missing = await lensRun("linguistics", "vocab-update", { params: { id: "nope", definition: "x" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(String(missing.result.error), /word not found/);

    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: "zenith", definition: "highest point", autoFetch: false } }, ctx);
    const id = add.result.word.id;
    const del = await lensRun("linguistics", "vocab-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);

    // Gone from the list now.
    const list = await lensRun("linguistics", "vocab-list", { params: {} }, ctx);
    assert.ok(!list.result.words.some((w) => w.id === id), "deleted word absent");

    // Deleting again rejects.
    const again = await lensRun("linguistics", "vocab-delete", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(String(again.result.error), /word not found/);
  });
});

describe("linguistics.quiz — multiple-choice generation + grading", () => {
  it("builds multiple-choice questions when >=4 defined words exist and grades by definition", async () => {
    const ctx = await depthCtx("depth:ling-quiz-MC");
    const seed = [
      ["alpha", "the first letter"],
      ["beta", "the second letter"],
      ["gamma", "the third letter"],
      ["delta", "the fourth letter"],
    ];
    let target = null;
    for (const [word, def] of seed) {
      const a = await lensRun("linguistics", "vocab-add",
        { params: { word, definition: def, autoFetch: false } }, ctx);
      if (word === "alpha") target = a.result.word;
    }
    const gen = await lensRun("linguistics", "quiz-generate", { params: { count: 4, mode: "multiple-choice" } }, ctx);
    assert.equal(gen.ok, true);
    assert.equal(gen.result.poolSize, 4);
    // With a 4-word pool and forced MC mode, every question is multiple-choice
    // with exactly 4 choices, one of which is the correct definition.
    assert.ok(gen.result.questions.every((q) => q.mode === "multiple-choice"), "all MC");
    const q0 = gen.result.questions[0];
    assert.equal(q0.choices.length, 4);
    assert.ok(q0.choices.includes(q0.answer), "correct answer is among choices");

    // Grade the alpha word's correct definition → MC correct worth 6 points.
    const grade = await lensRun("linguistics", "quiz-grade",
      { params: { wordId: target.id, mode: "multiple-choice", answer: "the first letter" } }, ctx);
    assert.equal(grade.ok, true);
    assert.equal(grade.result.correct, true);
    assert.equal(grade.result.points, 6); // MC correct
    assert.equal(grade.result.level, 1);
  });
});

describe("linguistics.deck — create / list / delete + word unassign", () => {
  it("creates a deck, lists it enriched, deletes it and unassigns its words", async () => {
    const ctx = await depthCtx("depth:ling-deck-A");
    const create = await lensRun("linguistics", "deck-create",
      { params: { name: "SAT Core", description: "high-frequency", theme: "exam" } }, ctx);
    assert.equal(create.ok, true);
    const deckId = create.result.deck.id;
    assert.equal(create.result.deck.name, "SAT Core");
    assert.equal(create.result.deck.theme, "exam");

    // Add a word into that deck.
    const add = await lensRun("linguistics", "vocab-add",
      { params: { word: " subterfuge".trim(), definition: "deceit to achieve a goal", autoFetch: false, deckId } }, ctx);
    assert.equal(add.result.word.deckId, deckId);

    const list = await lensRun("linguistics", "deck-list", { params: {} }, ctx);
    const deck = list.result.decks.find((d) => d.id === deckId);
    assert.ok(deck, "deck appears in list");
    assert.equal(deck.wordCount, 1); // enriched count

    // deck-delete on a bad id rejects.
    const bad = await lensRun("linguistics", "deck-delete", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /deck not found/);

    // Real delete unassigns the word (keeps the word itself).
    const del = await lensRun("linguistics", "deck-delete", { params: { id: deckId } }, ctx);
    assert.equal(del.ok, true);
    const words = await lensRun("linguistics", "vocab-list", { params: {} }, ctx);
    const w = words.result.words.find((x) => x.id === add.result.word.id);
    assert.ok(w, "word survives deck deletion");
    assert.equal(w.deckId, null, "word unassigned from deleted deck");
  });
});
