// Live-test finding (2026-10-17 ~09:05 ET): "Search the web: what is the
// latest stable version of Node.js? Give the source link." answered "The
// search found no relevant results". The keyless provider DID return rows;
// every one was dropped, correctly, because the query was wrong:
//
//   * shapeSearchQuery kept "Search the web:" and "Give the source link", so
//     Bing returned Google / Yahoo / DuckDuckGo home pages.
//   * With the clean query ("latest stable version of Node.js") Bing's
//     keyless page returns news home pages (Fox, CNN, AP) for "latest …".
//   * The compact retry ("stable version node js") ranked on "stable"
//     (dictionaries), and even nodejs.org hits were dropped because the
//     coverage filter required "stable" and "version" in the blurb.
//
// Fixtures under tests/fixtures/web-search are real responses recorded
// 2026-10-17 from www.bing.com and endoflife.date (scripts/styles stripped
// from the HTML). Egress is mocked.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shapeSearchQuery,
  compactSearchQuery,
  coversQuery,
  parseBingResults,
  isVersionQuery,
  matchReleaseProduct,
  releaseRowsFromProduct,
  webSearchForChat,
  _resetReleaseCache,
} from "../emergent/conscious-web-search.js";

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "web-search");
const fx = (f) => fs.readFileSync(path.join(FX, f), "utf8");
const BING_RAW = fx("bing-raw-prompt-2026-10-17.html");
const BING_LATEST = fx("bing-latest-stable-nodejs-2026-10-17.html");
const BING_GOOD = fx("bing-node-js-stable-version-2026-10-17.html");
const EOL_PRODUCTS = JSON.parse(fx("endoflife-v1-products-subset-2026-10-17.json"));
const EOL_NODE = JSON.parse(fx("endoflife-v1-nodejs-2026-10-17.json"));

const PROMPT = "Search the web: what is the latest stable version of Node.js? Give the source link.";
const Q = "latest stable version of Node.js";

const text = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

let urls;
function installFetch({ eol = true } = {}) {
  urls = [];
  globalThis.fetch = async (u) => {
    u = String(u); urls.push(u);
    if (u.includes("www.bing.com/search")) {
      const q = new URL(u).searchParams.get("q");
      if (q === "node js stable version") return text(BING_GOOD);
      if (q === Q) return text(BING_LATEST);
      return text(BING_RAW);
    }
    if (u.includes("api.duckduckgo.com")) return { ok: false, status: 202, json: async () => ({}) };
    if (u.endsWith("endoflife.date/api/v1/products")) return eol ? json(EOL_PRODUCTS) : { ok: false, status: 503 };
    if (u.endsWith("endoflife.date/api/v1/products/nodejs")) return json(EOL_NODE);
    throw new Error(`unexpected fetch ${u}`);
  };
}

beforeEach(() => {
  delete process.env.BRAVE_API_KEY; delete process.env.SEARXNG_URL;
  delete process.env.CONCORD_WEB_SEARCH_BING; delete process.env.CONCORD_WEB_SEARCH_RELEASES;
  _resetReleaseCache();
});
afterEach(() => { delete globalThis.fetch; });

describe("query shaping strips search directives and citation requests", () => {
  it("reduces the live prompt to the topic", () => {
    assert.equal(shapeSearchQuery(PROMPT), Q);
    assert.equal(shapeSearchQuery("Look up the boiling point of water and cite your sources"), "boiling point of water");
    assert.equal(shapeSearchQuery("search for copper prices, with links"), "copper prices");
    assert.equal(shapeSearchQuery("Google: Eiffel Tower height. Please include the source URL."), "Eiffel Tower height");
    // A bare directive is not erased into nothing.
    assert.equal(shapeSearchQuery("web search"), "web search");
    // Unchanged when there is no directive.
    assert.equal(shapeSearchQuery("What is the capital of France?"), "capital of France");
  });
  it("puts the subject first in the compact retry", () => {
    assert.equal(compactSearchQuery(PROMPT), "node js stable version");
    assert.equal(compactSearchQuery("What is the current copper price today?"), "copper price");
  });
});

describe("coverage filter on recorded Bing pages", () => {
  it("drops the search-engine home pages the unshaped prompt returned", () => {
    const rows = parseBingResults(BING_RAW, PROMPT);
    assert.ok(rows.length >= 3, "the recorded page has organic rows (not a block / parse failure)");
    assert.ok(rows.every((r) => !coversQuery(Q, r.title, r.snippet, r.url)));
  });
  it("drops the news home pages Bing returns for 'latest …'", () => {
    const rows = parseBingResults(BING_LATEST, Q);
    assert.ok(rows.length >= 3);
    assert.ok(rows.every((r) => !coversQuery(Q, r.title, r.snippet, r.url)));
  });
  it("keeps nodejs.org even though its blurb never says 'stable' or 'version'", () => {
    const rows = parseBingResults(BING_GOOD, Q);
    const node = rows.find((r) => r.url === "https://nodejs.org/");
    assert.ok(node, "recorded page ranks nodejs.org");
    assert.doesNotMatch(`${node.title} ${node.snippet}`, /stable|version/i);
    assert.equal(coversQuery(Q, node.title, node.snippet, node.url), true);
    // Host counts: "node" + "js" ↔ nodejs.org.
    assert.equal(coversQuery(Q, "Run JavaScript Everywhere", "free, open-source runtime", "https://nodejs.org/en"), true);
    // Still not a free pass: an unrelated page stays out.
    assert.equal(coversQuery(Q, "STABLE Definition & Meaning", "firmly fixed", "https://www.merriam-webster.com/dictionary/stable"), false);
  });
});

describe("release lookup (endoflife.date)", () => {
  it("detects version questions and resolves the product", () => {
    assert.equal(isVersionQuery(Q), true);
    assert.equal(isVersionQuery("copper prices"), false);
    const products = EOL_PRODUCTS.result;
    assert.equal(matchReleaseProduct(Q, products)?.name, "nodejs");
    assert.equal(matchReleaseProduct("latest python version", products)?.name, "python");
    assert.equal(matchReleaseProduct("current PostgreSQL release", products)?.name, "postgresql");
    assert.equal(matchReleaseProduct("latest stable version", products), null);
    assert.equal(matchReleaseProduct("latest version of the Zxqv widget", products), null);
  });
  it("builds cited rows with the newest release, newest LTS and the official page", () => {
    const rows = releaseRowsFromProduct(EOL_NODE.result, Q);
    assert.equal(rows[0].url, "https://nodejs.org/en/about/previous-releases");
    assert.equal(rows[1].url, "https://endoflife.date/nodejs");
    assert.match(rows[0].snippet, /Newest Node\.js release: 26\.12\.0 \(2026-10-14\)/);
    assert.match(rows[0].snippet, /Newest LTS release: 24\.\d+\.\d+/);
    assert.match(rows[0].content, /Official release page: https:\/\/nodejs\.org\/en\/about\/previous-releases/);
  });
});

describe("webSearchForChat end to end on the live prompt", () => {
  it("returns release rows plus covering nodejs.org hits instead of nothing", async () => {
    installFetch();
    const r = await webSearchForChat([PROMPT]);
    const got = r.map((x) => x.url);
    assert.equal(got[0], "https://nodejs.org/en/about/previous-releases");
    assert.ok(got.includes("https://endoflife.date/nodejs"));
    assert.ok(got.includes("https://nodejs.org/"));
    assert.ok(!got.some((u) => /google\.|yahoo\.|duckduckgo\.|cnn\.com|foxnews/.test(u)));
    const bingQs = urls.filter((u) => u.includes("bing.com")).map((u) => new URL(u).searchParams.get("q"));
    assert.deepEqual(bingQs, [Q, "node js stable version"]);
  });
  it("still finds nodejs.org through the web index when the release API is down", async () => {
    installFetch({ eol: false });
    const r = await webSearchForChat([PROMPT]);
    assert.ok(r.length >= 2);
    assert.ok(r.every((x) => x.provider === "bing"));
    assert.ok(r.some((x) => x.url.startsWith("https://nodejs.org/")));
  });
  it("CONCORD_WEB_SEARCH_RELEASES=0 skips the release API", async () => {
    process.env.CONCORD_WEB_SEARCH_RELEASES = "0";
    installFetch();
    await webSearchForChat([PROMPT]);
    assert.ok(!urls.some((u) => u.includes("endoflife.date")));
  });
});
