// Feed-cache phase 8d (server): the public-data actions on the public-lookup
// domain (NVD, EONET, Gutendex, Sketchfab, USGS, FEMA, REST Countries,
// sunrise-sunset, Imgflip, Onionoo, npm, OpenRouter). No network: the
// transport is stubbed, exactly like public-lookup.test.js.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPublicLookup from "../domains/public-lookup.js";
import {
  _resetPublicDataForTests, setPublicDataTransportForTests,
} from "../lib/public-data-sources.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const call = (name, params) => ACTIONS.get(`public-lookup.${name}`)({}, { id: null, data: {}, meta: {} }, params);

let calls;
function transport(handler) {
  calls = [];
  setPublicDataTransportForTests(async (url, init) => {
    calls.push({ url, init });
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
}

before(() => { registerPublicLookup(register); });
beforeEach(() => {
  _resetPublicDataForTests();
  delete process.env.CONCORD_PUBLIC_UA;
  delete process.env.NVD_API_KEY;
  calls = [];
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

describe("public-data: parameter injection is rejected with no fetch", () => {
  const BAD = [
    ["nvd-cves", { severity: "CRITICAL&resultsPerPage=1" }],
    ["nvd-cves", { severity: "critical" }],
    ["nvd-cves", { keyword: "http://evil.example" }],
    ["nvd-cves", { keyword: "openssl", severity: "HIGH" }],
    ["eonet-events", { status: "bogus" }],
    ["eonet-events", { category: "../../x" }],
    ["eonet-events", { category: "Wildfires" }],
    ["gutendex-books", {}],
    ["gutendex-books", { q: "dune", topic: "science" }],
    ["gutendex-books", { topic: "sci ence!" }],
    ["sketchfab-search", { q: "a://b" }],
    ["usgs-quakes", { feed: "../../etc/passwd" }],
    ["usgs-quakes", { feed: "all_month" }],
    ["fema-disasters", { state: "XX" }],
    ["fema-disasters", { state: "CA' OR '1'='1" }],
    ["restcountries-region", { region: "evil.com" }],
    ["restcountries-region", { region: "../europe" }],
    ["sunrise-sunset", { lat: 999, lng: 0 }],
    ["sunrise-sunset", { lat: "abc", lng: 0 }],
    ["sunrise-sunset", { lat: 40.7 }],
    ["npm-search", { q: "" }],
    ["npm-search", { q: "../x" }],
  ];
  for (const [name, params] of BAD) {
    it(`${name} ${JSON.stringify(params).slice(0, 60)}`, async () => {
      transport(() => ({}));
      const r = await call(name, params);
      assert.equal(r.ok, false);
      assert.equal(r.status, 400);
      assert.equal(calls.length, 0, "no upstream fetch may happen for invalid params");
    });
  }
});

describe("public-data: fixed URL templates", () => {
  it("nvd keyword search", async () => {
    transport(() => ({ vulnerabilities: [{ cve: { id: "CVE-1" } }] }));
    const r = await call("nvd-cves", { keyword: "openssl" });
    assert.equal(r.ok, true);
    assert.equal(r.result.data.vulnerabilities.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.host, "services.nvd.nist.gov");
    assert.equal(u.searchParams.get("keywordSearch"), "openssl");
    assert.equal(u.searchParams.get("resultsPerPage"), "25");
  });

  it("nvd severity feed, key sent as a header only when configured", async () => {
    transport(() => ({ vulnerabilities: [] }));
    await call("nvd-cves", { severity: "HIGH" });
    assert.equal(new URL(calls[0].url).searchParams.get("cvssV3Severity"), "HIGH");
    assert.equal(calls[0].init.headers.apiKey, undefined);

    process.env.NVD_API_KEY = "test-key-not-real";
    _resetPublicDataForTests();
    transport(() => ({ vulnerabilities: [] }));
    await call("nvd-cves", { severity: "HIGH" });
    assert.equal(calls[0].init.headers.apiKey, "test-key-not-real");
    assert.ok(!calls[0].url.includes("test-key-not-real"), "the key must never appear in a URL");
  });

  it("eonet: status=all omits the param; category passes through", async () => {
    transport(() => ({ events: [] }));
    await call("eonet-events", { status: "all", category: "wildfires" });
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("status"), null);
    assert.equal(u.searchParams.get("category"), "wildfires");
    assert.equal(u.searchParams.get("limit"), "30");
  });

  it("fema: state filter is built from the allowlisted code only", async () => {
    transport(() => ({ DisasterDeclarationsSummaries: [] }));
    await call("fema-disasters", { state: "CA" });
    assert.ok(calls[0].url.includes("$filter=state%20eq%20'CA'"));
    assert.ok(calls[0].url.includes("$top=30"));
  });

  it("sunrise-sunset: coordinates validated and formatted", async () => {
    transport(() => ({ results: { sunrise: "x" }, status: "OK" }));
    const r = await call("sunrise-sunset", { lat: 42.1, lng: -73.9 });
    assert.equal(r.ok, true);
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("lat"), "42.1000");
    assert.equal(u.searchParams.get("formatted"), "0");
  });

  it("openrouter: public list, no Authorization header is ever sent", async () => {
    transport(() => ({ data: [{ id: "m1" }] }));
    const r = await call("openrouter-models", {});
    assert.equal(r.ok, true);
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.equal(calls[0].init.headers.authorization, undefined);
  });
});

describe("public-data: cache + honesty", () => {
  it("the same request twice makes one upstream call", async () => {
    transport(() => ({ events: [{ id: "E1" }] }));
    const a = await call("eonet-events", { status: "open" });
    const b = await call("eonet-events", { status: "open" });
    assert.equal(calls.length, 1);
    assert.deepEqual(a.result.data, b.result.data);
  });

  it("upstream failure is an honest unavailable, never fabricated data", async () => {
    transport(() => 503);
    const r = await call("usgs-quakes", { feed: "2.5_day" });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
    assert.ok("lastOkAt" in r);
  });

  it("every action carries the descriptive User-Agent", async () => {
    transport(() => ({}));
    await call("imgflip-memes", {});
    assert.match(calls[0].init.headers["User-Agent"], /ConcordOS\/1\.0/);
  });
});
