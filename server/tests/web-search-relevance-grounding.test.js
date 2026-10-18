// Live-test finding (2026-10-17): web_search answered "copper prices" with
// "2000s commodities boom" and "Islamic State". The only search backend
// without a key was Wikipedia full-text search (DuckDuckGo's instant-answer
// API is not a web search), and the agent reply then quoted figures and
// links none of the results contained.
//
// Pins: a general-web provider (keyless Bing results page) runs before the
// Wikipedia fallback; hits must cover the query; time-sensitive questions
// never fall back to an encyclopedia; links in an agent reply must come
// from a tool result or the user's own text. Egress is mocked.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  parseBingResults,
  decodeBingHref,
  coversQuery,
  compactSearchQuery,
  isFreshnessQuery,
  webSearchForChat,
} from "../emergent/conscious-web-search.js";
import { collectAllowedUrls, enforceGroundedLinks, normalizeUrl, WEB_NO_RESULTS_RULE } from "../lib/chat/link-grounding.js";
import { runAgentLoop } from "../lib/chat-agent.js";

const b64u = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ck = (target) => `https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${b64u(target)}&amp;ntb=1`;

function bingHtml(rows) {
  return `<html><body><ol id="b_results">${rows.map((r) =>
    `<li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="${ck(r.url)}"><cite>${r.url}</cite></a></div>` +
    `<h2><a target="_blank" href="${ck(r.url)}" h="ID=SERP">${r.title}</a></h2>` +
    `<div class="b_caption"><p class="b_lineclamp2"><span class="news_dt">2 days ago</span>&nbsp;&#0183;&#32;${r.snippet}</p></div></li>`,
  ).join("")}</ol></body></html>`;
}

const COPPER_ROWS = [
  { url: "https://www.kitco.com/price/base-metals/copper", title: "<strong>Price</strong> of <strong>Copper</strong> per Pound - KITCO", snippet: "Live Copper Charts and Copper Spot Price from International Copper Markets" },
  { url: "https://current.com/", title: "Current | Future of Banking", snippet: "a difference between the current market price and the price you pay" },
  { url: "https://tradingeconomics.com/commodity/copper", title: "Copper - Price - Chart - Historical Data", snippet: "Copper prices rose to $4.9 per pound" },
];

function htmlResponse(text) {
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
}
function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

let urls;
function installFetch({ bing = [], wikiSearch = [] } = {}) {
  urls = [];
  globalThis.fetch = async (u) => {
    u = String(u);
    urls.push(u);
    if (u.includes("www.bing.com/search")) return htmlResponse(bingHtml(bing));
    if (u.includes("api.duckduckgo.com")) return jsonResponse({ AbstractText: "" });
    if (u.includes("list=search")) return jsonResponse({ query: { search: wikiSearch } });
    if (u.includes("/robots.txt")) return htmlResponse("User-agent: *\nAllow: /\n");
    if (u.includes("prop=extracts")) return jsonResponse({ query: { pages: { 1: { extract: "An article lead." } } } });
    throw new Error(`unexpected fetch ${u}`);
  };
}

beforeEach(() => { delete process.env.BRAVE_API_KEY; delete process.env.SEARXNG_URL; delete process.env.CONCORD_WEB_SEARCH_BING; });
afterEach(() => { delete globalThis.fetch; });

describe("Bing results page parsing", () => {
  it("decodes the /ck/a redirect to the real target and reads title + snippet", () => {
    assert.equal(decodeBingHref(ck("https://www.kitco.com/price/base-metals/copper")), "https://www.kitco.com/price/base-metals/copper");
    assert.equal(decodeBingHref("https://www.bing.com/ck/a?u=zz"), "");
    const rows = parseBingResults(bingHtml(COPPER_ROWS), "copper prices");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].url, "https://www.kitco.com/price/base-metals/copper");
    assert.equal(rows[0].title, "Price of Copper per Pound - KITCO");
    assert.match(rows[0].snippet, /^2 days ago · Live Copper Charts/);
    assert.equal(rows[0].provider, "bing");
  });
});

describe("relevance", () => {
  it("requires the hit to cover the query, not one shared word", () => {
    assert.equal(coversQuery("current copper price today", "Current | Future of Banking", "the current market price and the price you pay"), false);
    assert.equal(coversQuery("current copper price today", "Price of Copper per Pound - KITCO", "Live Copper Spot Price"), true);
    assert.equal(coversQuery("copper prices", "2000s commodities boom", "The boom in the prices of oil, gold"), false);
    assert.equal(coversQuery("copper prices", "Islamic State", "the group sold oil"), false);
  });
  it("treats freshness words as optional and drops them from the compact query", () => {
    assert.equal(compactSearchQuery("What is the current copper price today?"), "copper price");
    assert.equal(isFreshnessQuery("copper prices"), true);
    assert.equal(isFreshnessQuery("capital of France"), false);
  });
});

describe("webSearchForChat providers", () => {
  it("returns covering web hits for copper prices and never cites the unrelated Wikipedia pages", async () => {
    installFetch({
      bing: COPPER_ROWS,
      wikiSearch: [{ title: "2000s commodities boom", snippet: "copper prices rose" }, { title: "Islamic State", snippet: "copper prices" }],
    });
    const r = await webSearchForChat(["copper prices"]);
    const got = r.map((x) => x.url);
    assert.deepEqual(got, ["https://www.kitco.com/price/base-metals/copper", "https://tradingeconomics.com/commodity/copper"]);
    assert.ok(!urls.some((u) => u.includes("wikipedia.org")), "a price question must not fall back to Wikipedia");
  });

  it("returns nothing (no filler) for a price question the web providers cannot answer", async () => {
    installFetch({ bing: [], wikiSearch: [{ title: "2000s commodities boom", snippet: "copper prices" }] });
    const r = await webSearchForChat(["copper prices"]);
    assert.deepEqual(r, []);
  });

  it("asks the keyless page with the compact query first when filler words derail it", async () => {
    urls = [];
    globalThis.fetch = async (u) => {
      u = String(u); urls.push(u);
      if (u.includes("www.bing.com/search")) {
        const q = decodeURIComponent(new URL(u).searchParams.get("q"));
        return htmlResponse(bingHtml(q === "copper price" ? COPPER_ROWS : [COPPER_ROWS[1]]));
      }
      if (u.includes("api.duckduckgo.com")) return jsonResponse({});
      throw new Error(`unexpected fetch ${u}`);
    };
    const r = await webSearchForChat(["current copper price today"]);
    assert.ok(r.some((x) => x.url.includes("kitco.com")));
    assert.ok(!r.some((x) => x.url.includes("current.com")));
    assert.deepEqual(urls.filter((u) => u.includes("bing.com")).map((u) => new URL(u).searchParams.get("q")), ["copper price"]);
  });

  it("CONCORD_WEB_SEARCH_BING=0 disables the keyless page", async () => {
    process.env.CONCORD_WEB_SEARCH_BING = "0";
    installFetch({ bing: COPPER_ROWS });
    await webSearchForChat(["copper prices"]);
    assert.ok(!urls.some((u) => u.includes("bing.com")));
  });
});

describe("link grounding", () => {
  it("keeps result links, strips invented ones, and keeps markdown labels", () => {
    const allowed = collectAllowedUrls(JSON.stringify({ results: [{ url: "https://www.kitco.com/price/base-metals/copper" }] }));
    const g = enforceGroundedLinks(
      "Per [Kitco](https://kitco.com/price/base-metals/copper/), see also https://fake.example.com/copper. And [LME](https://www.lme.com/copper).",
      allowed,
    );
    assert.match(g.text, /\[Kitco\]\(https:\/\/kitco\.com\/price\/base-metals\/copper\/\)/);
    assert.match(g.text, /see also \[link removed\]\./);
    assert.match(g.text, /And LME\./);
    assert.deepEqual(g.removed.sort(), ["https://fake.example.com/copper", "https://lme.com/copper"]);
    assert.match(g.text, /Removed 2 links/);
  });
  it("normalizes host case, www, fragment and trailing slash", () => {
    assert.equal(normalizeUrl("https://WWW.Example.com/a/#x"), "https://example.com/a");
    assert.equal(normalizeUrl("https://en.wikipedia.org/wiki/Foo_(bar))."), "https://en.wikipedia.org/wiki/Foo_(bar)");
  });
});

describe("agent loop grounding", () => {
  it("strips a link the web_search results never contained and passes the grounding rule to the brain", async () => {
    const seen = [];
    let n = 0;
    const brain = async ({ messages }) => {
      seen.push(messages[messages.length - 1].content);
      n += 1;
      if (n === 1) return { ok: true, text: '[TOOL_CALL: {"tool": "web_search", "params": {"query": "copper prices"}}]', provider: "t", model: "t" };
      return { ok: true, text: "Copper is about $4.90/lb per https://tradingeconomics.com/commodity/copper and https://invented.example.org/copper-2026.", provider: "t", model: "t" };
    };
    const runMacro = async (d, a) => (d === "expert_mode" && a === "web_search"
      ? { ok: true, query: "copper prices", results: [{ title: "Copper", url: "https://tradingeconomics.com/commodity/copper", snippet: "Copper rose to $4.9 per pound" }] }
      : { ok: true });
    const r = await runAgentLoop({ db: null, userId: "u1", message: "what are copper prices doing?", runMacro, lensActions: new Map(), history: [], opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
    assert.equal(r.ok, true);
    assert.match(r.answer, /tradingeconomics\.com\/commodity\/copper/);
    assert.doesNotMatch(r.answer, /invented\.example\.org/);
    assert.deepEqual(r.linksRemoved, ["https://invented.example.org/copper-2026"]);
    assert.match(seen[1], /Answer only from these results/);
  });

  it("tells the brain plainly when the search found nothing relevant", async () => {
    const seen = [];
    let n = 0;
    const brain = async ({ messages }) => {
      seen.push(messages[messages.length - 1].content);
      n += 1;
      return n === 1
        ? { ok: true, text: '[TOOL_CALL: {"tool": "web_search", "params": {"query": "zxqv gadget"}}]', provider: "t", model: "t" }
        : { ok: true, text: "The search found nothing relevant.", provider: "t", model: "t" };
    };
    const runMacro = async () => ({ ok: true, query: "zxqv gadget", results: [] });
    const r = await runAgentLoop({ db: null, userId: "u1", message: "look up zxqv gadget", runMacro, lensActions: new Map(), history: [], opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
    assert.equal(r.ok, true);
    assert.ok(seen[1].includes(WEB_NO_RESULTS_RULE.slice(0, 40)));
  });
});
