/**
 * Tier-2 contract test for Wikipedia REST macro registrations.
 *
 * Pins:
 *   - registers live_wiki_search + live_wiki_summary across 10 lenses
 *   - shared handler instances across lenses (one fix lands everywhere)
 *   - input validation rejects missing + overlong query/title
 *
 * Live external fetches NOT exercised — would couple CI to Wikipedia.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerWikipediaSearchMacros from "../domains/wikipedia-search.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

const LENSES = [
  "history", "philosophy", "linguistics", "education",
  "desert", "ocean", "neuro", "geology", "space", "global",
];

describe("wikipedia-search macro registration", () => {
  it("registers live_wiki_search across all 10 target lenses", () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    for (const lens of LENSES) {
      assert.ok(r.map.has(`${lens}.live_wiki_search`), `missing ${lens}.live_wiki_search`);
    }
  });

  it("registers live_wiki_summary across all 10 target lenses", () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    for (const lens of LENSES) {
      assert.ok(r.map.has(`${lens}.live_wiki_summary`), `missing ${lens}.live_wiki_summary`);
    }
  });

  it("each macro carries a note", () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    for (const lens of LENSES) {
      assert.ok(r.map.get(`${lens}.live_wiki_search`).meta?.note);
      assert.ok(r.map.get(`${lens}.live_wiki_summary`).meta?.note);
    }
  });
});

describe("shared handler identity", () => {
  it("live_wiki_search uses the same handler across every lens", () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const base = r.map.get("history.live_wiki_search").handler;
    for (const lens of LENSES) {
      assert.equal(r.map.get(`${lens}.live_wiki_search`).handler, base);
    }
  });

  it("live_wiki_summary uses the same handler across every lens", () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const base = r.map.get("history.live_wiki_summary").handler;
    for (const lens of LENSES) {
      assert.equal(r.map.get(`${lens}.live_wiki_summary`).handler, base);
    }
  });
});

describe("input validation", () => {
  it("live_wiki_search rejects missing query", async () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const res = await r.map.get("history.live_wiki_search").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("live_wiki_search rejects overlong query (250 chars)", async () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const res = await r.map.get("history.live_wiki_search").handler({}, { query: "x".repeat(250) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });

  it("live_wiki_summary rejects missing title", async () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const res = await r.map.get("history.live_wiki_summary").handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_title");
  });

  it("live_wiki_summary rejects overlong title (250 chars)", async () => {
    const r = makeRegistry();
    registerWikipediaSearchMacros(r.register);
    const res = await r.map.get("history.live_wiki_summary").handler({}, { title: "x".repeat(250) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "title_too_long");
  });
});
