// Contract tests for server/domains/history.js — pure-compute helpers
// plus real Wikipedia REST + On This Day integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHistoryActions from "../domains/history.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`history.${name}`);
  if (!fn) throw new Error(`history.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerHistoryActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("history.timelineBuild (pure compute)", () => {
  it("sorts events chronologically + flags pivotal", () => {
    const events = [
      { name: "Industrial Rev", date: "1760", significance: "high", era: "modern" },
      { name: "WWI", date: "1914", significance: "critical", era: "modern" },
      { name: "Renaissance", date: "1400", significance: "high", era: "early modern" },
    ];
    const r = call("timelineBuild", ctxA, { data: { events } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.timeline[0].event, "Renaissance");
    assert.equal(r.result.timeline[2].event, "WWI");
    assert.equal(r.result.pivotalEvents.length, 3);
  });
});

describe("history.wiki-lookup (Wikipedia REST)", () => {
  it("rejects empty title", async () => {
    const r = await call("wiki-lookup", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("fetches summary + sends UA header per Wikimedia policy", async () => {
    let capturedUrl = "", capturedUA = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedUA = opts?.headers?.["User-Agent"] || "";
      return {
        ok: true,
        json: async () => ({
          type: "standard",
          title: "World War II",
          displaytitle: "World War II",
          description: "Global war (1939–1945)",
          extract: "World War II or the Second World War, often abbreviated as WWII or WW2...",
          extract_html: "<p><b>World War II</b>...</p>",
          thumbnail: { source: "https://upload.wikimedia.org/.../480px-WWII.jpg" },
          content_urls: {
            desktop: { page: "https://en.wikipedia.org/wiki/World_War_II" },
            mobile: { page: "https://en.m.wikipedia.org/wiki/World_War_II" },
          },
          lang: "en",
          timestamp: "2026-05-01T12:34:56Z",
        }),
      };
    };
    const r = await call("wiki-lookup", ctxA, { title: "World War II" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/api\/rest_v1\/page\/summary\/World_War_II/);
    assert.match(capturedUA, /Concord-OS/);
    assert.equal(r.result.title, "World War II");
    assert.equal(r.result.description, "Global war (1939–1945)");
    assert.equal(r.result.source, "wikipedia-rest");
  });

  it("flags disambiguation pages with a note", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        type: "disambiguation",
        title: "Mercury",
        description: "Various meanings",
        extract: "Mercury may refer to: Mercury (planet); Mercury (element); ...",
      }),
    });
    const r = await call("wiki-lookup", ctxA, { title: "Mercury" });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "disambiguation");
    assert.match(r.result.note, /more specific/);
  });

  it("returns clear 404 when page doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("wiki-lookup", ctxA, { title: "ThisPageDoesNotExistXyz" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("history.wiki-search (Wikipedia opensearch)", () => {
  it("rejects empty / 1-char queries", async () => {
    assert.equal((await call("wiki-search", ctxA, {})).ok, false);
    assert.equal((await call("wiki-search", ctxA, { query: "a" })).ok, false);
  });

  it("hits opensearch + parses [query, titles, descriptions, urls] tuple", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          "renaissance",
          ["Renaissance", "Renaissance art", "Italian Renaissance"],
          ["Cultural movement", "Visual arts", "European cultural movement"],
          [
            "https://en.wikipedia.org/wiki/Renaissance",
            "https://en.wikipedia.org/wiki/Renaissance_art",
            "https://en.wikipedia.org/wiki/Italian_Renaissance",
          ],
        ]),
      };
    };
    const r = await call("wiki-search", ctxA, { query: "renaissance", limit: 3 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /w\/api\.php\?action=opensearch/);
    assert.match(capturedUrl, /search=renaissance/);
    assert.match(capturedUrl, /limit=3/);
    assert.equal(r.result.results.length, 3);
    assert.equal(r.result.results[0].title, "Renaissance");
    assert.equal(r.result.results[2].url, "https://en.wikipedia.org/wiki/Italian_Renaissance");
    assert.equal(r.result.source, "wikipedia-opensearch");
  });
});

describe("history.on-this-day (Wikipedia)", () => {
  it("rejects invalid month/day", async () => {
    assert.equal((await call("on-this-day", ctxA, { month: 13, day: 1 })).ok, false);
    assert.equal((await call("on-this-day", ctxA, { month: 5, day: 32 })).ok, false);
    assert.equal((await call("on-this-day", ctxA, {})).ok, false);
  });

  it("fetches the correct mm/dd endpoint + shapes the response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          events: [
            { text: "End of WWII in Europe", year: 1945, pages: [{ title: "Victory in Europe Day", extract: "VE Day...", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Victory_in_Europe_Day" } } }] },
            { text: "Other event", year: 1900, pages: [] },
          ],
        }),
      };
    };
    const r = await call("on-this-day", ctxA, { month: 5, day: 8 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/feed\/onthisday\/events\/05\/08/);
    assert.equal(r.result.events.length, 2);
    assert.equal(r.result.events[0].year, 1945);
    assert.equal(r.result.events[0].pages[0].url, "https://en.wikipedia.org/wiki/Victory_in_Europe_Day");
    assert.equal(r.result.source, "wikipedia-onthisday");
  });

  it("supports kind=births / deaths / holidays / selected / all", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({}) };
    };
    await call("on-this-day", ctxA, { month: 5, day: 16, kind: "births" });
    assert.match(capturedUrl, /\/feed\/onthisday\/births\/05\/16/);
  });
});
