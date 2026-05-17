/**
 * Tier-2 contract test for the third wave of REAL free-API macro
 * registrations (scholarly-apis.js — CrossRef, OpenAlex, Datamuse,
 * Free Dictionary).
 *
 * Pins:
 *   - all 9 expected (domain, macro) pairs register
 *   - shared handlers point at the same function instance across
 *     domains so a bug fix lands everywhere
 *   - input validation rejects missing + overlong query/word
 *   - every macro carries a note for /api/lens introspection
 *
 * Live external fetches are NOT exercised here — that would couple CI
 * to CrossRef / OpenAlex / Datamuse / dictionaryapi.dev availability.
 *
 * Run: node --test server/tests/scholarly-apis-registration.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerScholarlyApiMacros from "../domains/scholarly-apis.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

const EXPECTED_PAIRS = [
  "paper.live_crossref",
  "research.live_crossref",
  "paper.live_openalex",
  "research.live_openalex",
  "linguistics.live_datamuse",
  "creative-writing.live_datamuse",
  "poetry.live_datamuse",
  "linguistics.live_dictionary",
  "education.live_dictionary",
];

describe("scholarly-apis macro registration", () => {
  it("registers all 9 expected (domain, macro) pairs", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.has(key), `missing registration: ${key}`);
    }
  });

  it("each macro carries a note", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.get(key).meta?.note, `${key} missing note`);
    }
  });
});

describe("shared handler identity", () => {
  it("CrossRef handler shared across paper + research", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    assert.equal(
      r.map.get("paper.live_crossref").handler,
      r.map.get("research.live_crossref").handler,
    );
  });

  it("OpenAlex handler shared across paper + research", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    assert.equal(
      r.map.get("paper.live_openalex").handler,
      r.map.get("research.live_openalex").handler,
    );
  });

  it("Datamuse handler shared across linguistics + creative-writing + poetry", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const a = r.map.get("linguistics.live_datamuse").handler;
    const b = r.map.get("creative-writing.live_datamuse").handler;
    const c = r.map.get("poetry.live_datamuse").handler;
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it("Dictionary handler shared across linguistics + education", () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    assert.equal(
      r.map.get("linguistics.live_dictionary").handler,
      r.map.get("education.live_dictionary").handler,
    );
  });
});

describe("input validation — missing field", () => {
  it("CrossRef rejects missing query", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("paper.live_crossref").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("OpenAlex rejects missing query", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("paper.live_openalex").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("Datamuse rejects missing word", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("linguistics.live_datamuse").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_word");
  });

  it("Free Dictionary rejects missing word", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("linguistics.live_dictionary").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_word");
  });
});

describe("input validation — overlong field", () => {
  it("CrossRef rejects overlong query (350 chars)", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("paper.live_crossref").handler({}, { query: "x".repeat(350) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });

  it("Datamuse rejects overlong word (100 chars)", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("linguistics.live_datamuse").handler({}, { word: "x".repeat(100) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "word_too_long");
  });

  it("Free Dictionary rejects overlong word (100 chars)", async () => {
    const r = makeRegistry();
    registerScholarlyApiMacros(r.register);
    const res = await r.map.get("linguistics.live_dictionary").handler({}, { word: "x".repeat(100) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "word_too_long");
  });
});
