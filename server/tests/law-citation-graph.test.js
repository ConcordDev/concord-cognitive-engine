// Contract tests for the new `law.citation-graph` macro — real
// CourtListener `opinions-cited` citation-edge lookup ("who cites this
// opinion"), closing docs/lens-specs/law-capability-map.md's "Citation
// graph" gap. Same mock-fetch pattern as
// server/tests/law-real-data-domain-parity.test.js (network to
// courtlistener.com is disabled in this sandbox).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "../domains/law.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law.${name}`);
  if (!fn) throw new Error(`law.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawActions(register); });
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.COURTLISTENER_API_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("law.citation-graph (CourtListener opinions-cited)", () => {
  it("rejects a missing/invalid opinionId", async () => {
    const r1 = await call("citation-graph", ctxA, {});
    assert.equal(r1.ok, false);
    assert.match(r1.error, /opinionId/);

    const r2 = await call("citation-graph", ctxA, { opinionId: "not-a-number" });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /opinionId/);
  });

  it("defaults to citedBy direction (who cites this opinion) and filters on cited_opinion", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ count: 0, results: [] }) };
    };
    const r = await call("citation-graph", ctxA, { opinionId: 2812209 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /courtlistener\.com\/api\/rest\/v4\/opinions-cited\//);
    assert.match(capturedUrl, /cited_opinion=2812209/);
    assert.doesNotMatch(capturedUrl, /[?&]citing_opinion=/);
    assert.equal(r.result.direction, "citedBy");
    assert.equal(r.result.opinionId, 2812209);
  });

  it("direction: 'cites' filters on citing_opinion instead (what this opinion cites)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ count: 0, results: [] }) };
    };
    const r = await call("citation-graph", ctxA, { opinionId: 555, direction: "cites" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /citing_opinion=555/);
    assert.doesNotMatch(capturedUrl, /[?&]cited_opinion=/);
    assert.equal(r.result.direction, "cites");
  });

  it("shapes real opinions-cited rows (resource-URL citing/cited fields + depth) honestly, no fabricated case names", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        count: 2,
        results: [
          {
            resource_uri: "https://www.courtlistener.com/api/rest/v4/opinions-cited/1/",
            id: 1,
            citing_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/10008139/",
            cited_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/2812209/",
            depth: 4,
          },
          {
            resource_uri: "https://www.courtlistener.com/api/rest/v4/opinions-cited/2/",
            id: 2,
            citing_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/9000001/",
            cited_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/2812209/",
            depth: 1,
          },
        ],
      }),
    });
    const r = await call("citation-graph", ctxA, { opinionId: 2812209 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.totalHits, 2);
    assert.equal(r.result.source, "courtlistener");

    const [first, second] = r.result.citations;
    assert.equal(first.id, 1);
    assert.equal(first.citingOpinionId, 10008139);
    assert.equal(first.citingOpinionUrl, "https://www.courtlistener.com/api/rest/v4/opinions/10008139/");
    assert.equal(first.citedOpinionId, 2812209);
    assert.equal(first.citedOpinionUrl, "https://www.courtlistener.com/api/rest/v4/opinions/2812209/");
    // direction is citedBy, so "otherOpinionId" is the citING opinion (the one doing the citing)
    assert.equal(first.otherOpinionId, 10008139);
    assert.equal(first.depth, 4);
    // No caseName / title field is fabricated anywhere on the row.
    assert.equal("caseName" in first, false);

    assert.equal(second.depth, 1);
    assert.equal(second.otherOpinionId, 9000001);
  });

  it("otherOpinionId flips to the CITED opinion when direction is 'cites'", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{
          id: 7,
          citing_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/555/",
          cited_opinion: "https://www.courtlistener.com/api/rest/v4/opinions/2812209/",
          depth: 2,
        }],
      }),
    });
    const r = await call("citation-graph", ctxA, { opinionId: 555, direction: "cites" });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].otherOpinionId, 2812209);
  });

  it("defensively extracts opinion ids from non-string shapes (number or nested object) without throwing", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{
          id: 9,
          citing_opinion: 42, // already a bare number (defensive path)
          cited_opinion: { id: 2812209, resource_uri: "https://www.courtlistener.com/api/rest/v4/opinions/2812209/" },
          depth: null, // missing depth degrades to null, never fabricated
        }],
      }),
    });
    const r = await call("citation-graph", ctxA, { opinionId: 2812209 });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].citingOpinionId, 42);
    assert.equal(r.result.citations[0].citedOpinionId, 2812209);
    assert.equal(r.result.citations[0].depth, null);
  });

  it("returns an honest empty result on zero citations (no fabricated placeholder rows)", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ count: 0, results: [] }) });
    const r = await call("citation-graph", ctxA, { opinionId: 999999 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.citations, []);
    assert.equal(r.result.count, 0);
  });

  it("uses COURTLISTENER_API_TOKEN env when set", async () => {
    process.env.COURTLISTENER_API_TOKEN = "test-token-abc";
    let capturedAuth = "";
    globalThis.fetch = async (_url, opts) => {
      capturedAuth = opts?.headers?.Authorization || "";
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const r = await call("citation-graph", ctxA, { opinionId: 1 });
    assert.equal(capturedAuth, "Token test-token-abc");
    assert.equal(r.result.authenticatedWithToken, true);
  });

  it("honest failure on rate limit (429)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("citation-graph", ctxA, { opinionId: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit.*COURTLISTENER_API_TOKEN/);
  });

  it("honest failure on network error (unreachable) — never fabricates a citation list", async () => {
    globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
    const r = await call("citation-graph", ctxA, { opinionId: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /courtlistener unreachable/);
  });

  it("clamps limit to [1, 50] (0/falsy limit degrades to the default 20, same as the sibling macros)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("citation-graph", ctxA, { opinionId: 1, limit: 999 });
    assert.match(capturedUrl, /page_size=50/);

    await call("citation-graph", ctxA, { opinionId: 1, limit: -5 });
    assert.match(capturedUrl, /page_size=1/);

    await call("citation-graph", ctxA, { opinionId: 1 });
    assert.match(capturedUrl, /page_size=20/);
  });
});
