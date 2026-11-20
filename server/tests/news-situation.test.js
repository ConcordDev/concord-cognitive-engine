// news.situation — the Situation Room's picture: places from a story's own
// words, outlet country only as a labelled fallback, windowed timeline,
// same-event clusters, co-mention arcs, and the feed's real status. GDELT is
// a recorded stand-in (no network); every news.* handler is the real one.
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions, { __resetGdeltCacheForTests, __configureGdeltForTests } from "../domains/news.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache } from "../lib/feed-cache.js";
import { placesIn, countryKey, PLACES } from "../lib/news-places.js";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const ACTIONS = new Map();
const register = (domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn);
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const call = (name, params = {}) => ACTIONS.get(`news.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3_600_000;
const gdeltDate = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const realFetch = globalThis.fetch;

before(() => {
  registerNewsActions(register);
  __setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  __resetGdeltCacheForTests();
  configureFeedCache({ logUpstream: () => {}, log: () => {} });
  __configureGdeltForTests({ spacingMs: 0, everyMs: 0 });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
});
afterEach(() => { globalThis.fetch = realFetch; __resetGdeltCacheForTests(); });

const add = (title, extra = {}) => call("article-add", { title, source: extra.source || "Desk", publishedAt: extra.publishedAt || iso(10 * 60_000), summary: extra.summary });

describe("news-places — read only what the text names", () => {
  it("matches names, people and cities; longer names first; proper nouns only", () => {
    assert.deepEqual(placesIn("South Sudan clashes").map((p) => p.key), ["S. Sudan"]);
    assert.deepEqual(placesIn("Kremlin says Kyiv talks stalled").map((p) => p.key), ["Russia", "Ukraine"]);
    assert.deepEqual(placesIn("New Delhi heatwave").map((p) => p.key), ["India"]);
    assert.deepEqual(placesIn("Indiana floods and Somalia drought").map((p) => p.key), ["Somalia"]);
    assert.deepEqual(placesIn("they told us nothing"), []);
    assert.deepEqual(placesIn("US tariffs").map((p) => p.key), ["United States of America"]);
  });
  it("an ambiguous country needs more than its bare name", () => {
    assert.deepEqual(placesIn("Michael Jordan buys a team"), []);
    assert.deepEqual(placesIn("Georgia election count"), []);
    assert.deepEqual(placesIn("Turkey prices rise before Thanksgiving"), []);
    assert.deepEqual(placesIn("Jordan's king meets leaders in Amman").map((p) => p.key), ["Jordan"]);
    assert.deepEqual(placesIn("Istanbul hosts summit").map((p) => p.key), ["Turkey"]);
  });
  it("covers exactly the countries on the map the lens draws", { skip: !existsSync(new URL("../../concord-frontend/node_modules/world-atlas/countries-110m.json", import.meta.url)) }, () => {
    const req = createRequire(import.meta.url);
    const topo = req("../../concord-frontend/node_modules/world-atlas/countries-110m.json");
    const names = topo.objects.countries.geometries.map((g) => g.properties.name).sort();
    assert.deepEqual(Object.keys(PLACES).sort(), names);
    assert.equal(countryKey("United States"), "United States of America");
    assert.equal(countryKey("Atlantis"), null);
  });
});

describe("news.situation", () => {
  it("places library stories by their words, links co-mentioned countries, rolls regions up", async () => {
    await add("Kremlin says Kyiv talks stalled", { source: "Wire A" });
    await add("Russia and Ukraine trade drone strikes overnight", { source: "Wire B", publishedAt: iso(2 * H) });
    await add("Ukrainian grain exports rebound", { source: "Wire C", publishedAt: iso(5 * H) });
    await add("Markets steady as investors wait", { source: "Wire D" });
    const r = await call("situation", { hours: 24 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const res = r.result;
    assert.equal(res.counts.stories, 4);
    assert.equal(res.counts.library, 4);
    assert.equal(res.counts.mentioned, 3);
    assert.equal(res.counts.unplaced, 1);
    const ua = res.regions.find((x) => x.key === "Ukraine");
    assert.deepEqual([ua.count, ua.mentioned, ua.outlet, ua.sources, ua.last3h], [3, 3, 0, 3, 2]);
    assert.deepEqual(res.arcs, [{ a: "Russia", b: "Ukraine", count: 2 }]);
    const unplaced = res.stories.find((s) => s.title.startsWith("Markets"));
    assert.deepEqual([unplaced.places, unplaced.basis], [[], null]);
  });

  it("windows by time, buckets by hour, and never invents a date", async () => {
    await add("Floods in Manila", { publishedAt: iso(30 * H) });
    await add("Manila reopens ports", { publishedAt: iso(1 * H) });
    await add("Undated note about Lagos", { publishedAt: "sometime" });
    let res = (await call("situation", { hours: 24 })).result;
    assert.equal(res.counts.stories, 1);
    assert.equal(res.counts.undated, 1);
    assert.equal(res.timeline.length, 25); // 24 hours plus the current hour
    assert.equal(res.timeline.reduce((a, b) => a + b.count, 0), 1);
    res = (await call("situation", { hours: 48 })).result;
    assert.equal(res.counts.stories, 2);
    assert.equal(res.regions.find((x) => x.key === "Philippines").count, 2);
  });

  it("groups the same event told by different outlets and says how many covered it", async () => {
    await add("Central banks split on interest rate path", { source: "Paper A" });
    await add("Central banks split on rate path", { source: "Paper B" });
    await add("Volcano erupts in Iceland", { source: "Paper C" });
    const res = (await call("situation", {})).result;
    const banks = res.stories.filter((s) => s.title.startsWith("Central banks"));
    assert.equal(banks[0].clusterId, banks[1].clusterId);
    assert.deepEqual(banks.map((s) => s.coverage), [2, 2]);
    assert.equal(res.stories.find((s) => s.title.startsWith("Volcano")).coverage, 1);
  });

  it("places a live story by the outlet's country only when its words name nowhere, and says so", async () => {
    globalThis.fetch = async (url) => {
      if (!String(url).includes("gdeltproject")) return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
      return { ok: true, status: 200, json: async () => ({ articles: [
        { title: "Parliament passes budget after long night", url: "https://n.example/a", domain: "n.example", sourcecountry: "Kenya", seendate: gdeltDate(H) },
        { title: "Floods hit Nairobi suburbs", url: "https://n.example/b", domain: "n.example", sourcecountry: "United Kingdom", seendate: gdeltDate(2 * H) },
      ] }) };
    };
    const res = (await call("situation", { categories: ["world"] })).result;
    assert.equal(res.feed.status, "fresh");
    const budget = res.stories.find((s) => s.title.startsWith("Parliament"));
    assert.deepEqual([budget.basis, budget.places.map((p) => p.key), budget.kind], ["outlet", ["Kenya"], "live"]);
    const floods = res.stories.find((s) => s.title.startsWith("Floods"));
    assert.deepEqual([floods.basis, floods.places.map((p) => p.key)], ["mentioned", ["Kenya"]]); // not the UK outlet
    const ke = res.regions.find((x) => x.key === "Kenya");
    assert.deepEqual([ke.count, ke.mentioned, ke.outlet], [2, 1, 1]);
  });

  it("reports an unreachable feed as unavailable with its reason, and shows nothing it did not get", async () => {
    const res = (await call("situation", { categories: ["tech", "science"] })).result;
    assert.equal(res.feed.status, "unavailable");
    assert.deepEqual(Object.keys(res.feed.categories).sort(), ["science", "tech"]);
    assert.equal(res.counts.live, 0);
    assert.equal(res.stories.length, 0);
  });

  it("clamps the window and ignores unknown categories", async () => {
    for (const hours of [-5, 0, "x", 1e9, null]) {
      const res = (await call("situation", { hours, categories: ["nope", "../etc"] })).result;
      assert.ok(res.window.hours >= 1 && res.window.hours <= 72, String(hours));
      assert.ok(Object.keys(res.feed.categories).every((c) => c !== "nope" && c !== "../etc"));
    }
    assert.equal((await call("situation", { hours: 1e9 })).result.window.hours, 72);
    assert.equal((await call("situation", { hours: -5 })).result.window.hours, 1);
  });
});
