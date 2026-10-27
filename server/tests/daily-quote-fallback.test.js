/**
 * Contract test for the daily/reflection live_quote fallback chain
 * (curated-free-apis.js): Quotable → ZenQuotes → DummyJSON → local list.
 *
 * Pins:
 *   - Quotable success is reported as the primary (degraded: false)
 *   - a Quotable failure (expired TLS cert) falls back to ZenQuotes and is
 *     labelled degraded with the reason
 *   - when every network source fails the handler still returns ok:true
 *     with a non-empty local quote, deterministic for a given day
 *   - requested author/tag filters the fallback cannot honour are reported
 *     in filtersIgnored, not silently dropped
 *
 * globalThis.fetch is stubbed per test and restored afterwards.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import registerCuratedFreeApiMacros from "../domains/curated-free-apis.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

function getQuotable() {
  const r = makeRegistry();
  registerCuratedFreeApiMacros(r.register);
  return r.map.get("daily.live_quote").handler;
}

// Node's fetch reports an expired certificate as TypeError("fetch failed")
// with the real code on `cause`.
function certExpiredError() {
  const err = new TypeError("fetch failed");
  err.cause = { code: "CERT_HAS_EXPIRED" };
  return err;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const QUOTABLE_OK = [
  { _id: "q1", content: "Stay hungry.", author: "Steve Jobs", tags: ["wisdom"], length: 12, authorSlug: "steve-jobs" },
];

const ZEN_RANDOM = [{ q: "Be yourself; everyone else is already taken.", a: "Oscar Wilde", h: "<blockquote>x</blockquote>" }];
const ZEN_LIST = Array.from({ length: 50 }, (_, i) => ({ q: `Zen quote number ${i}.`, a: `Author ${i}`, h: "" }));

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("daily.live_quote — Quotable primary", () => {
  it("Quotable ok -> source Quotable, degraded false, no ignored filters", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /api\.quotable\.io/);
      return json(QUOTABLE_OK);
    };
    const res = await getQuotable()({}, { limit: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.source, "Quotable");
    assert.equal(res.degraded, false);
    assert.equal(res.degradedReason, null);
    assert.deepEqual(res.filtersIgnored, []);
    assert.equal(res.quotes[0].content, "Stay hungry.");
    assert.equal(res.quotes[0].id, "q1");
  });
});

describe("daily.live_quote — fallback to ZenQuotes", () => {
  it("Quotable cert error + ZenQuotes ok -> source ZenQuotes, degraded true with reason", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("api.quotable.io")) throw certExpiredError();
      if (String(url).includes("zenquotes.io/api/random")) return json(ZEN_RANDOM);
      throw new Error(`unexpected url ${url}`);
    };
    const res = await getQuotable()({}, { limit: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.source, "ZenQuotes");
    assert.equal(res.degraded, true);
    assert.match(res.degradedReason, /Quotable: .*CERT_HAS_EXPIRED/);
    assert.equal(res.quotes.length, 1);
    assert.deepEqual(res.quotes[0], {
      id: null,
      content: "Be yourself; everyone else is already taken.",
      author: "Oscar Wilde",
      tags: [],
      length: res.quotes[0].content.length,
      authorSlug: "oscar-wilde",
    });
    assert.equal(calls.length, 2, "stops at the first working fallback");
  });

  it("default limit uses the ZenQuotes list endpoint and returns the requested count", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("api.quotable.io")) throw certExpiredError();
      if (String(url).includes("zenquotes.io/api/quotes")) return json(ZEN_LIST);
      throw new Error(`unexpected url ${url}`);
    };
    const res = await getQuotable()({}, {});
    assert.equal(res.source, "ZenQuotes");
    assert.equal(res.quotes.length, 3);
    assert.ok(res.quotes.every(q => q.content.startsWith("Zen quote number")));
  });

  it("requested author filter that the fallback cannot honour is reported in filtersIgnored", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("api.quotable.io")) throw certExpiredError();
      if (String(url).includes("zenquotes.io/api/random")) return json(ZEN_RANDOM);
      throw new Error(`unexpected url ${url}`);
    };
    const res = await getQuotable()({}, { limit: 1, author: "Oscar Wilde", tag: "wisdom" });
    assert.equal(res.source, "ZenQuotes");
    assert.deepEqual(res.filtersIgnored, ["author", "tag"]);
  });
});

describe("daily.live_quote — DummyJSON fallback", () => {
  it("ZenQuotes HTTP 429 + DummyJSON ok -> source DummyJSON, reason names both failures", async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.quotable.io")) throw certExpiredError();
      if (u.includes("zenquotes.io")) return new Response("Too many requests", { status: 429 });
      if (u.includes("dummyjson.com/quotes/random")) return json({ id: 7, quote: "Dummy quote.", author: "Dummy Author" });
      throw new Error(`unexpected url ${u}`);
    };
    const res = await getQuotable()({}, { limit: 1 });
    assert.equal(res.source, "DummyJSON");
    assert.equal(res.degraded, true);
    assert.match(res.degradedReason, /Quotable:.*ZenQuotes: HTTP 429/);
    assert.equal(res.quotes[0].id, "dummyjson:7");
    assert.equal(res.quotes[0].authorSlug, "dummy-author");
  });
});

describe("daily.live_quote — all network sources down", () => {
  it("returns ok:true from the local list, non-empty, degraded true", async () => {
    globalThis.fetch = async () => {
      throw certExpiredError();
    };
    const res = await getQuotable()({}, { limit: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.source, "local");
    assert.equal(res.degraded, true);
    assert.match(res.degradedReason, /Quotable:.*ZenQuotes:.*DummyJSON:/);
    assert.equal(res.quotes.length, 1);
    assert.ok(res.quotes[0].content.length > 0);
    assert.ok(res.quotes[0].author.length > 0);
    assert.match(res.quotes[0].id, /^local:\d+$/);
  });

  it("local pick is deterministic for the same day (no Math.random)", async () => {
    globalThis.fetch = async () => {
      throw certExpiredError();
    };
    const handler = getQuotable();
    const a = await handler({}, { limit: 2 });
    const b = await handler({}, { limit: 2 });
    assert.deepEqual(a.quotes.map(q => q.id), b.quotes.map(q => q.id));
    assert.equal(a.quotes.length, 2);
  });

  it("treats an empty upstream list as a failed source, not a success", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("api.quotable.io")) throw certExpiredError();
      return json([]);
    };
    const res = await getQuotable()({}, { limit: 1 });
    assert.equal(res.source, "local");
    assert.match(res.degradedReason, /ZenQuotes: empty response/);
  });
});
