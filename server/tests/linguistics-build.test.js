// Linguistics build — behavioural tests (S-LIN-4 syllable correction,
// S-LIN-5 export provider).
//
// The FK syllable counter counted vowel LETTERS, so "unbelievable"
// scored 6 syllables against 5 true and the pass's probe sentence
// totalled 11 against 10 hand-counted (FK 28.8). The corrected counter
// counts vowel groups; the probe must now grade from exactly 10
// syllables: 0.39*3 + 11.8*(10/3) - 15.59 = 24.9.

import { test } from "node:test";
import assert from "node:assert/strict";

import registerLinguisticsActions from "../domains/linguistics.js";
import { collectLensExport, _clearLensExportProvidersForTests } from "../lib/lens-export.js";

const handlers = new Map();
registerLinguisticsActions((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
const run = (name, artifact, params) => handlers.get(`linguistics.${name}`)({}, artifact, params);

test("textAnalysis grades the probe sentence from 10 syllables, not 11", () => {
  const out = run("textAnalysis", { data: { text: "Unhappiness is unbelievable." } });
  assert.equal(out.ok, true);
  assert.equal(out.result.wordCount, 3);
  assert.equal(out.result.readabilityGrade, 24.9);
});

test("analyze agrees with textAnalysis on the same text (one engine, one counter)", () => {
  const out = run("analyze", { data: {} }, { text: "Unhappiness is unbelievable." });
  assert.equal(out.ok, true);
  assert.equal(out.result.readabilityGrade, 24.9);
});

test("analyze classes -able words (the affix coverage gap is closed)", () => {
  const out = run("analyze", { data: {} }, { text: "The unbelievable fox jumps." });
  assert.equal(out.ok, true);
  assert.equal(out.result.wordClasses.adjective, 1);
  assert.match(out.result.content, /adjective ×1/);
});

test("the fox pangram keeps its verified shape under the corrected counter", () => {
  const out = run("textAnalysis", { data: { text: "The quick brown fox jumps over the lazy dog" } });
  assert.equal(out.ok, true);
  assert.equal(out.result.wordCount, 9);
  assert.equal(out.result.vocabularySize, 8);
  assert.equal(out.result.lexicalDiversity, 89);
});

test("export provider surfaces the actor's vocab words and decks", async () => {
  globalThis._concordSTATE = {
    linguisticsLens: {
      words: new Map([["user-1", [
        { id: "vw1", word: "unhappiness", definition: "the state of being unhappy", partOfSpeech: "noun", example: null, mastery: 2, deckId: "dk1", createdAt: "2026-10-30T00:00:00.000Z" },
        { id: "vw2", word: "fox", definition: "a wild mammal", partOfSpeech: "noun", example: null, mastery: 0, deckId: null, createdAt: "2026-10-30T00:00:00.000Z" },
      ]]]),
      progress: new Map(),
      decks: new Map([["user-1", [
        { id: "dk1", name: "PR2 Morphology Deck", description: "", theme: "morphology", createdAt: "2026-10-30T00:00:00.000Z" },
      ]]]),
    },
  };
  try {
    const out = await collectLensExport({
      runMacro: async () => ({ ok: true, artifacts: [] }),
      domain: "linguistics",
      ctx: { actor: { userId: "user-1" } },
      limit: 100,
    });
    assert.equal(out.ok, true);
    const words = out.artifacts.filter((a) => a.type === "vocab_word");
    const decks = out.artifacts.filter((a) => a.type === "vocab_deck");
    assert.equal(words.length, 2);
    assert.ok(words.some((a) => a.title === "unhappiness"));
    assert.equal(decks.length, 1);
    assert.match(decks[0].data.content ?? "", /1 word: unhappiness/);
  } finally {
    _clearLensExportProvidersForTests();
    delete globalThis._concordSTATE;
  }
});
