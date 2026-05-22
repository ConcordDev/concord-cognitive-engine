// Contract tests for server/domains/linguistics.js — pure-compute
// text-analysis helpers plus real Free Dictionary API + Datamuse.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLinguisticsActions from "../domains/linguistics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`linguistics.${name}`);
  if (!fn) throw new Error(`linguistics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLinguisticsActions(register); });
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("linguistics.dictionary-lookup (Free Dictionary)", () => {
  it("rejects empty word", async () => {
    assert.equal((await call("dictionary-lookup", ctxA, {})).ok, false);
  });

  it("hits Free Dictionary + shapes entry response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          word: "serendipity",
          phonetic: "/ˌsɛɹənˈdɪpɪti/",
          phonetics: [
            { text: "/ˌsɛɹənˈdɪpɪti/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/serendipity-us.mp3" },
          ],
          origin: "1754: coined by Horace Walpole, suggested by The Three Princes of Serendip.",
          meanings: [{
            partOfSpeech: "noun",
            definitions: [{
              definition: "The faculty or phenomenon of finding valuable or agreeable things not sought for.",
              example: "Stumbling onto that book was pure serendipity.",
              synonyms: ["luck", "chance"],
              antonyms: ["misfortune"],
            }],
            synonyms: [], antonyms: [],
          }],
        }]),
      };
    };
    const r = await call("dictionary-lookup", ctxA, { word: "serendipity" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.dictionaryapi\.dev\/api\/v2\/entries\/en\/serendipity/);
    assert.equal(r.result.entries[0].word, "serendipity");
    assert.equal(r.result.entries[0].meanings[0].partOfSpeech, "noun");
    assert.equal(r.result.entries[0].meanings[0].definitions[0].synonyms[0], "luck");
    assert.equal(r.result.source, "free-dictionary-api");
  });

  it("returns clear 404 for unknown words", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("dictionary-lookup", ctxA, { word: "xyzbogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /word not found/);
  });
});

describe("linguistics.datamuse-words (word associations)", () => {
  it("rejects when no query constraint supplied", async () => {
    const r = await call("datamuse-words", ctxA, { max: 10 });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least one of/);
  });

  it("supports rhymes (rel_rhy)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { word: "cat", score: 1000, numSyllables: 1 },
          { word: "bat", score: 900, numSyllables: 1 },
          { word: "rat", score: 850, numSyllables: 1 },
        ]),
      };
    };
    const r = await call("datamuse-words", ctxA, { rel_rhy: "hat", max: 5 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.datamuse\.com\/words/);
    assert.match(capturedUrl, /rel_rhy=hat/);
    assert.match(capturedUrl, /max=5/);
    assert.equal(r.result.words.length, 3);
    assert.equal(r.result.words[0].word, "cat");
    assert.equal(r.result.source, "datamuse");
  });

  it("supports means-like (ml) + synonyms (rel_syn) combined", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [] };
    };
    await call("datamuse-words", ctxA, { ml: "happy", rel_syn: "happy" });
    assert.match(capturedUrl, /ml=happy/);
    assert.match(capturedUrl, /rel_syn=happy/);
  });

  it("supports spelled-like wildcards (sp)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [] };
    };
    await call("datamuse-words", ctxA, { sp: "c?t" });
    assert.match(capturedUrl, /sp=c%3Ft/);
  });

  it("surfaces datamuse network errors", async () => {
    const r = await call("datamuse-words", ctxA, { rel_rhy: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /datamuse unreachable/);
  });
});

// ─── Backlog parity macros ──────────────────────────────────────────

// One Free Dictionary entry, used to stub fetch deterministically.
const DICT_ENTRY = [{
  word: "candor",
  phonetic: "/ˈkændər/",
  phonetics: [
    { text: "/ˈkændər/", audio: "https://media/candor-us.mp3" },
    { text: "/ˈkandə/", audio: "" },
  ],
  origin: "early 17th century: from Latin candor 'whiteness, sincerity'.",
  meanings: [{
    partOfSpeech: "noun",
    definitions: [{
      definition: "the quality of being open and honest.",
      example: "a man of refreshing candor",
      synonyms: ["frankness"], antonyms: [],
    }],
    synonyms: [], antonyms: [],
  }],
}];

describe("linguistics.vocab-add — auto-fetch definition", () => {
  it("chains the dictionary when no definition supplied", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => DICT_ENTRY });
    const r = await call("vocab-add", ctxA, { word: "candor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.autoFetched, true);
    assert.match(r.result.word.definition, /open and honest/);
    assert.equal(r.result.word.partOfSpeech, "noun");
    assert.ok(r.result.word.audio);
  });
  it("keeps the user definition and skips auto-fetch when supplied", async () => {
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => DICT_ENTRY }; };
    const r = await call("vocab-add", ctxA, { word: "candor", definition: "my own def" });
    assert.equal(r.ok, true);
    assert.equal(r.result.autoFetched, false);
    assert.equal(r.result.word.definition, "my own def");
    assert.equal(fetched, false);
  });
});

describe("linguistics.quiz engine", () => {
  it("rejects a quiz when no words have definitions", () => {
    const r = call("quiz-generate", ctxA, {});
    assert.equal(r.ok, false);
  });
  it("generates an adaptive question set from real vocabulary", async () => {
    for (const w of ["alpha", "bravo", "charlie", "delta", "echo"]) {
      await call("vocab-add", ctxA, { word: w, definition: `meaning of ${w}`, autoFetch: false });
    }
    const r = call("quiz-generate", ctxA, { count: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.questions.length, 4);
    assert.equal(r.result.poolSize, 5);
    for (const q of r.result.questions) {
      assert.ok(q.wordId && q.prompt && q.answer);
      assert.ok(q.mode === "typing" || q.mode === "multiple-choice");
    }
  });
  it("forces typing mode and grades a correct/incorrect answer", async () => {
    const w = (await call("vocab-add", ctxA, { word: "lucid", definition: "clear and easy to understand", autoFetch: false })).result.word;
    const qs = call("quiz-generate", ctxA, { count: 1, mode: "typing" });
    assert.equal(qs.result.questions[0].mode, "typing");
    const hit = call("quiz-grade", ctxA, { wordId: w.id, answer: "LUCID", mode: "typing" });
    assert.equal(hit.ok, true);
    assert.equal(hit.result.correct, true);
    assert.equal(hit.result.level, 1);
    assert.ok(hit.result.points > 0);
    const miss = call("quiz-grade", ctxA, { wordId: w.id, answer: "wrong", mode: "typing" });
    assert.equal(miss.result.correct, false);
    assert.equal(miss.result.level, 0);
  });
});

describe("linguistics.progress streaks & gamification", () => {
  it("accumulates points and reports badges + daily goal", async () => {
    const w = (await call("vocab-add", ctxA, { word: "verdant", definition: "green with vegetation", autoFetch: false })).result.word;
    call("vocab-review", ctxA, { id: w.id, known: true });
    const r = call("progress-stats", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.points > 0);
    assert.equal(r.result.streak, 1);
    assert.ok(Array.isArray(r.result.badges));
    assert.equal(r.result.dailyGoal, 20);
  });
  it("sets a custom daily goal within bounds", () => {
    const r = call("progress-set-goal", ctxA, { dailyGoal: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.dailyGoal, 40);
    assert.equal(call("progress-stats", ctxA, {}).result.dailyGoal, 40);
    // out-of-range is clamped, not rejected
    assert.equal(call("progress-set-goal", ctxA, { dailyGoal: 9999 }).result.dailyGoal, 500);
  });
});

describe("linguistics.decks — curated word lists", () => {
  it("creates, lists, imports words into, and deletes a deck", async () => {
    const deck = call("deck-create", ctxA, { name: "GRE Pack", theme: "exam" }).result.deck;
    assert.ok(deck.id);
    assert.equal(call("deck-list", ctxA, {}).result.count, 1);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => DICT_ENTRY });
    const imp = await call("deck-import", ctxA, { deckId: deck.id, words: ["candor", "candor"] });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.addedCount, 1);
    assert.equal(imp.result.skippedCount, 1);
    const listed = call("deck-list", ctxA, {}).result.decks[0];
    assert.equal(listed.wordCount, 1);
    call("deck-delete", ctxA, { id: deck.id });
    assert.equal(call("deck-list", ctxA, {}).result.count, 0);
  });
  it("rejects import into a missing deck", async () => {
    const r = await call("deck-import", ctxA, { deckId: "nope", words: ["x"] });
    assert.equal(r.ok, false);
  });
});

describe("linguistics.pronounce / word-context / etymology", () => {
  beforeEach(() => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => DICT_ENTRY });
  });
  it("pronounce returns IPA + audio clip", async () => {
    const r = await call("pronounce", ctxA, { word: "candor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ipa, "/ˈkændər/");
    assert.match(r.result.audio, /candor-us\.mp3/);
    assert.ok(r.result.phonetics.length >= 1);
  });
  it("word-context returns real usage sentences", async () => {
    const r = await call("word-context", ctxA, { word: "candor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.match(r.result.examples[0].sentence, /refreshing candor/);
  });
  it("etymology surfaces the dictionary origin field", async () => {
    const r = await call("etymology", ctxA, { word: "candor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasEtymology, true);
    assert.match(r.result.origin, /Latin candor/);
  });
  it("pronounce rejects an empty word", async () => {
    assert.equal((await call("pronounce", ctxA, {})).ok, false);
  });
});
