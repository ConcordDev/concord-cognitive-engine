import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPublicLookup from "../domains/public-lookup.js";
import {
  _resetPublicLookupForTests, setPublicLookupTransportForTests, seBackoffRemainingMs,
} from "../lib/public-lookup-sources.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const call = (name, params) => ACTIONS.get(`public-lookup.${name}`)({}, { id: null, data: {}, meta: {} }, params);

let calls;
function transport(handler) {
  calls = [];
  setPublicLookupTransportForTests(async (url, init) => {
    calls.push({ url, init });
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
}

before(() => { registerPublicLookup(register); });
beforeEach(() => {
  _resetPublicLookupForTests();
  delete process.env.CONCORD_PUBLIC_UA;
  delete process.env.STACKEXCHANGE_KEY;
  calls = [];
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

describe("public-lookup: parameter injection is rejected with no fetch", () => {
  const BAD = [
    ["wiki-summary", { lang: "en", title: "../etc/passwd" }],
    ["wiki-summary", { lang: "en", title: "http://evil.example/x" }],
    ["wiki-summary", { lang: "en", title: "a\nb" }],
    ["wiki-summary", { lang: "en", title: "x".repeat(201) }],
    ["wiki-summary", { lang: "evil.com/", title: "Heart" }],
    ["wiki-summary", { lang: "xx", title: "Heart" }],
    ["wiki-search", { lang: "en", q: "a://b" }],
    ["wiki-search", { lang: "en", q: "" }],
    ["wiki-onthisday", { kind: "all", month: 13, day: 1 }],
    ["wiki-onthisday", { kind: "../x", month: 1, day: 1 }],
    ["wikidata-entity", { id: "Q42/../x" }],
    ["wikidata-entity", { id: "q42" }],
    ["wikidata-entity", { id: "Q1234567890123" }],
    ["wikidata-search", { q: "https://x" }],
    ["commons-search", { q: "../../x" }],
    ["commons-search", { q: "a\r\nHost: evil" }],
    ["se-search", { site: "evil.com", q: "x" }],
    ["se-search", { site: "law", q: "x", tagged: "y" }],
    ["se-search", { site: "law", tagged: "a b/../c" }],
    ["se-search", { site: "law", q: "x", sort: "bogus" }],
    ["hn-search", { q: "x", tags: "bogus" }],
    ["hn-search", { q: "http://x", tags: "story" }],
    ["hn-search", { q: "x".repeat(300) }],
  ];
  for (const [name, params] of BAD) {
    it(`${name} ${JSON.stringify(params).slice(0, 60)}`, async () => {
      transport(() => ({}));
      const r = await call(name, params);
      assert.equal(r.ok, false);
      assert.equal(r.status, 400);
      assert.equal(calls.length, 0);
    });
  }
});

describe("public-lookup: fixed templates, UA, caching", () => {
  it("wiki-summary builds the REST URL, sends the default UA, and caches one upstream call per key", async () => {
    transport(() => ({ title: "Heart", extract: "An organ." }));
    const a = await call("wiki-summary", { lang: "en", title: "Heart" });
    const b = await call("wiki-summary", { lang: "en", title: "Heart" });
    assert.equal(a.ok, true);
    assert.equal(a.result.data.title, "Heart");
    assert.equal(a.result.stale, false);
    assert.match(a.result.attribution.text, /CC BY-SA 4\.0/);
    assert.deepEqual(b.result.data, a.result.data);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://en.wikipedia.org/api/rest_v1/page/summary/Heart");
    assert.equal(calls[0].init.headers["User-Agent"], "ConcordOS/1.0 (https://concord-os.org; contact@concord-os.org)");
  });

  it("CONCORD_PUBLIC_UA overrides the User-Agent", async () => {
    process.env.CONCORD_PUBLIC_UA = "TestUA/9 (mailto:t@example.com)";
    transport(() => ({ query: { search: [] } }));
    await call("wiki-search", { lang: "de", q: "Herz" });
    assert.equal(calls[0].init.headers["User-Agent"], "TestUA/9 (mailto:t@example.com)");
    assert.match(calls[0].url, /^https:\/\/de\.wikipedia\.org\/w\/api\.php\?action=query&list=search&srsearch=Herz/);
  });

  it("encodes titles and keys distinct params separately", async () => {
    transport((u) => ({ u }));
    await call("wiki-summary", { lang: "en", title: "AC/DC" });
    await call("wiki-summary", { lang: "fr", title: "AC/DC" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://en.wikipedia.org/api/rest_v1/page/summary/AC%2FDC");
  });

  it("wikidata-entity, wikidata-search, commons-search and onthisday use fixed hosts", async () => {
    transport(() => ({ ok: 1 }));
    await call("wikidata-entity", { id: "Q42" });
    await call("wikidata-search", { q: "Tesla" });
    await call("commons-search", { q: "van gogh" });
    await call("wiki-onthisday", { kind: "selected", month: 3, day: 9 });
    const hosts = calls.map((c) => new URL(c.url).host);
    assert.deepEqual(hosts, ["www.wikidata.org", "www.wikidata.org", "commons.wikimedia.org", "en.wikipedia.org"]);
    assert.equal(calls[0].url, "https://www.wikidata.org/wiki/Special:EntityData/Q42.json");
    assert.match(calls[1].url, /action=wbsearchentities&search=Tesla/);
    assert.match(calls[2].url, /gsrsearch=filetype%3Abitmap\+van\+gogh/);
    assert.equal(calls[3].url, "https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/03/09");
  });

  it("se-search q / tagged / list templates; STACKEXCHANGE_KEY is appended only when set", async () => {
    transport(() => ({ items: [] }));
    await call("se-search", { site: "stackoverflow", q: "async await" });
    await call("se-search", { site: "law", tagged: "contract-law", sort: "votes" });
    await call("se-search", { site: "money", sort: "activity" });
    assert.match(calls[0].url, /^https:\/\/api\.stackexchange\.com\/2\.3\/search\/advanced\?order=desc&sort=relevance&site=stackoverflow&pagesize=25&q=async\+await$/);
    assert.match(calls[1].url, /\/2\.3\/questions\?.*tagged=contract-law/);
    assert.match(calls[2].url, /\/2\.3\/questions\?order=desc&sort=activity&site=money/);
    assert.ok(!calls.some((c) => c.url.includes("key=")));

    _resetPublicLookupForTests();
    process.env.STACKEXCHANGE_KEY = "k123";
    transport(() => ({ items: [] }));
    await call("se-search", { site: "math", q: "group" });
    assert.match(calls[0].url, /&key=k123$/);
  });

  it("hn-search templates: query, tag-only feed, and by-date", async () => {
    transport(() => ({ hits: [] }));
    await call("hn-search", { q: "rust", tags: "story" });
    await call("hn-search", { tags: "front_page" });
    await call("hn-search", { q: "rust", tags: "story", byDate: true });
    assert.equal(calls[0].url, "https://hn.algolia.com/api/v1/search?query=rust&tags=story&hitsPerPage=25");
    assert.equal(calls[1].url, "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25");
    assert.equal(calls[2].url, "https://hn.algolia.com/api/v1/search_by_date?query=rust&tags=story&hitsPerPage=25");
  });
});

describe("public-lookup: honest failure, stale and budget behavior", () => {
  it("upstream failure with nothing cached => unavailable, nothing invented", async () => {
    transport(() => 503);
    const r = await call("wiki-summary", { lang: "en", title: "Heart" });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
    assert.match(r.reason, /upstream_error/);
    assert.equal(r.result, undefined);
  });

  it("budget exhausted with a stale entry => stale data; with none => unavailable", async () => {
    // hn-algolia perMin is 60: take every token with distinct keys, then ask for a new one.
    transport(() => ({ hits: [{ title: "x" }] }));
    for (let i = 0; i < 60; i++) {
      const r = await call("hn-search", { q: `q${i}`, tags: "story" });
      assert.equal(r.ok, true);
    }
    assert.equal(calls.length, 60);
    const over = await call("hn-search", { q: "brand-new", tags: "story" });
    assert.equal(over.ok, false);
    assert.equal(over.status, "unavailable");
    assert.equal(over.reason, "budget_exhausted");
    assert.equal(calls.length, 60);
    // an already-cached key is still served (fresh) with no upstream call
    const cached = await call("hn-search", { q: "q3", tags: "story" });
    assert.equal(cached.ok, true);
    assert.equal(calls.length, 60);
  });

  it("StackExchange `backoff` pauses the source: cached keys served stale, new keys unavailable, no fetch", async () => {
    transport(() => ({ items: [{ title: "t" }], backoff: 30 }));
    const first = await call("se-search", { site: "law", q: "contracts" });
    assert.equal(first.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(seBackoffRemainingMs() > 25_000);

    const again = await call("se-search", { site: "law", q: "contracts" });
    assert.equal(again.ok, true);
    assert.equal(again.result.stale, true);

    const other = await call("se-search", { site: "law", q: "torts" });
    assert.equal(other.ok, false);
    assert.equal(other.reason, "upstream_backoff");
    assert.equal(calls.length, 1);
  });

  it("StackExchange keyless per-minute budget (10) refuses the 11th distinct call without a fetch", async () => {
    transport(() => ({ items: [] }));
    // 10/min cap bites first; just assert the 11th distinct call in a minute is refused without a fetch.
    for (let i = 0; i < 10; i++) assert.equal((await call("se-search", { site: "law", q: `a${i}` })).ok, true);
    const r = await call("se-search", { site: "law", q: "a-eleven" });
    assert.equal(r.reason, "budget_exhausted");
    assert.equal(calls.length, 10);
  });
});
