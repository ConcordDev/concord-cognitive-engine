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
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

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
