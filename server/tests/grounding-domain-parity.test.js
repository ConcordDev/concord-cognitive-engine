// Contract tests for server/domains/grounding.js — fact-grounding macros.
// Covers the Ground News / fact-check parity surface: multi-source evidence
// aggregation, confidence rating, source bias labeling, audit trail,
// trending claims, shareable cards, and rebuttal linking.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGroundingActions from "../domains/grounding.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";


// external-fetch.js routes through the SSRF guard (lib/public-fetch.js), so
// stubbing globalThis.fetch alone no longer intercepts anything -- the guard
// does a real DNS lookup first and fails on a fake hostname. Install
// public-fetch's documented module-scope test transport and delegate to
// whatever globalThis.fetch currently is, so each test's existing stub and
// restore lifecycle keeps working unchanged. Production never calls this.
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`grounding.${name}`);
  if (!fn) throw new Error(`grounding.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerGroundingActions(register); });

beforeEach(() => {
  // fresh STATE per test so per-user Maps don't leak
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  clearExternalFetchCache();
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("grounding.aggregateEvidence", () => {
  it("rejects missing claim", () => {
    const r = call("aggregateEvidence", ctxA, { evidence: [{ text: "x" }] });
    assert.equal(r.ok, false);
  });

  it("rejects empty evidence", () => {
    const r = call("aggregateEvidence", ctxA, { claim: "the sky is blue" });
    assert.equal(r.ok, false);
  });

  it("weights sources by bias table and produces a probability verdict", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: "renewable energy capacity doubled",
      evidence: [
        { text: "Studies confirmed and verified the doubling.", sourceUrl: "reuters.com" },
        { text: "Reporting shows the trend is accurate.", sourceUrl: "apnews.com" },
        { text: "This is a debunked myth and inaccurate.", sourceUrl: "breitbart.com" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceCount, 3);
    assert.ok(r.result.knownSourceCount >= 2);
    assert.ok(r.result.probabilityTrue > 0.5);
    assert.ok(Array.isArray(r.result.citations));
    assert.ok(r.result.citations[0].bias);
  });
});

describe("grounding.confidenceRating", () => {
  it("rejects zero evidence counts", () => {
    const r = call("confidenceRating", ctxA, { probabilityTrue: 0.8 });
    assert.equal(r.ok, false);
  });

  it("returns a calibrated band + interval", () => {
    const r = call("confidenceRating", ctxA, {
      probabilityTrue: 0.85, supporting: 5, contradicting: 1, neutral: 0, avgSourceWeight: 0.8,
    });
    assert.equal(r.ok, true);
    assert.ok(["high confidence", "moderate confidence", "low confidence", "inconclusive"].includes(r.result.confidenceBand));
    assert.ok(r.result.interval.lower <= r.result.interval.upper);
    assert.equal(typeof r.result.recommendation, "string");
  });
});

describe("grounding.sourceBias", () => {
  it("rejects empty input", () => {
    assert.equal(call("sourceBias", ctxA, {}).ok, false);
  });

  it("labels a known source from the published reference table", () => {
    const r = call("sourceBias", ctxA, { url: "foxnews.com" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sources[0].rated, true);
    assert.equal(r.result.sources[0].lean, "right");
  });

  it("computes lean spread across a source array", () => {
    const r = call("sourceBias", ctxA, { sources: ["reuters.com", "msnbc.com", "breitbart.com"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.leanSpread >= 4);
    assert.equal(r.result.ratedCount, 3);
  });
});

describe("grounding.recordCheck + auditTrail", () => {
  it("records a check and surfaces it in the trail", () => {
    const rec = call("recordCheck", ctxA, {
      claim: "the earth orbits the sun", verdict: "likely true",
      probabilityTrue: 0.99, confidence: 0.95, sourceCount: 3,
      sources: ["nasa.gov", "science.org"],
    });
    assert.equal(rec.ok, true);
    assert.ok(rec.result.recorded.id);

    const trail = call("auditTrail", ctxA, { limit: 50 });
    assert.equal(trail.ok, true);
    assert.equal(trail.result.totalChecks, 1);
    assert.equal(trail.result.checks[0].verdict, "likely true");
    assert.ok(trail.result.trail.length >= 1);
    assert.ok(trail.result.stats.avgProbabilityTrue > 0.9);
  });

  it("rejects recordCheck with no claim", () => {
    assert.equal(call("recordCheck", ctxA, { verdict: "x" }).ok, false);
  });
});

describe("grounding.trendingClaims", () => {
  it("surfaces checkable claims from the Wikimedia feed", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        news: [{ story: "A major scientific breakthrough was announced today." }],
        mostread: { articles: [{ titles: { normalized: "Climate change" }, views: 50000 }] },
      }),
    });
    const r = await call("trendingClaims", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.result.claims.length >= 1);
    assert.ok(r.result.claims.some((c) => c.suggestedClaim));
  });

  it("surfaces an error when the feed is unreachable", async () => {
    const r = await call("trendingClaims", ctxA, { limit: 5 });
    assert.equal(r.ok, false);
  });
});

describe("grounding.factCheckCard", () => {
  it("builds a shareable card with share text", () => {
    const r = call("factCheckCard", ctxA, {
      claim: "vaccines cause autism", verdict: "likely false",
      probabilityTrue: 0.03, confidence: 0.97,
      summary: "Overwhelming evidence refutes this.",
      sources: ["cdc.gov", "who.int"],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.card.id);
    assert.equal(r.result.card.emoji, "❌");
    assert.match(r.result.card.shareText, /FACT-CHECK/);
    assert.equal(r.result.card.sourceCount, 2);
  });

  it("rejects an empty claim", () => {
    assert.equal(call("factCheckCard", ctxA, { verdict: "x" }).ok, false);
  });
});

describe("grounding.linkRebuttal + rebuttalsFor", () => {
  it("links a rebuttal to a recorded check and lists it", () => {
    const rec = call("recordCheck", ctxA, { claim: "coffee is bad for you", verdict: "disputed" });
    const checkId = rec.result.recorded.id;

    const link = call("linkRebuttal", ctxA, {
      checkId,
      counterClaim: "Moderate coffee intake is associated with health benefits.",
      counterEvidence: [{ text: "Meta-analysis found benefits.", sourceUrl: "nature.com" }],
    });
    assert.equal(link.ok, true);
    assert.equal(link.result.rebuttal.checkId, checkId);

    const list = call("rebuttalsFor", ctxA, { checkId });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.rebuttals[0].stance, "rebuts");
  });

  it("rejects a rebuttal to a non-existent check", () => {
    const r = call("linkRebuttal", ctxA, { checkId: "nope", counterClaim: "x" });
    assert.equal(r.ok, false);
  });
});

describe("grounding.discoverCoverage (real GDELT)", () => {
  it("rejects an empty claim", async () => {
    const r = await call("discoverCoverage", ctxA, { claim: "" });
    assert.equal(r.ok, false);
  });

  it("returns an honest failure when GDELT is unreachable (hermetic default)", async () => {
    // beforeEach already sets globalThis.fetch to throw "network disabled".
    const r = await call("discoverCoverage", ctxA, { claim: "renewable energy capacity doubled" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "gdelt_unreachable");
    assert.match(r.error, /GDELT unreachable/);
  });

  it("discovers real coverage, bias-labels each hit, and shapes evidenceCandidates for aggregateEvidence", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          articles: [
            {
              title: "Renewable energy capacity doubled, report confirmed",
              url: "https://reuters.com/energy/renewables-double",
              domain: "reuters.com",
              language: "English",
              sourcecountry: "United Kingdom",
              seendate: "20260701T120000Z",
              socialimage: "https://reuters.com/img.jpg",
            },
            {
              title: "Skeptics say renewable growth figures are misleading",
              url: "https://breitbart.com/energy/skeptics",
              domain: "breitbart.com",
              language: "English",
              sourcecountry: "United States",
              seendate: "20260701T130000Z",
            },
            {
              title: "Unrated blog covers the story too",
              url: "https://some-obscure-blog.example/post",
              domain: "some-obscure-blog.example",
              language: "English",
              sourcecountry: "Germany",
              seendate: "20260701T140000Z",
            },
          ],
        }),
      };
    };

    const r = await call("discoverCoverage", ctxA, { claim: "renewable energy capacity doubled", maxRecords: 10 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
    assert.match(capturedUrl, /mode=ArtList/);
    assert.match(capturedUrl, /maxrecords=10/);

    assert.equal(r.result.count, 3);
    assert.equal(r.result.source, "GDELT Project (real-time global news index, no key required)");

    const reutersHit = r.result.articles.find((a) => a.sourceName === "reuters.com");
    assert.ok(reutersHit);
    assert.equal(reutersHit.bias.known, true);
    assert.equal(reutersHit.bias.lean, "center");
    assert.equal(reutersHit.stance, "supports"); // title contains "confirmed"
    assert.equal(reutersHit.publishedAt, "2026-07-01T12:00:00Z");
    assert.equal(reutersHit.sourceCountry, "United Kingdom");

    const breitbartHit = r.result.articles.find((a) => a.sourceName === "breitbart.com");
    assert.equal(breitbartHit.bias.lean, "far-right");
    assert.equal(breitbartHit.stance, "contradicts"); // title contains "misleading"

    const unratedHit = r.result.articles.find((a) => a.sourceName === "some-obscure-blog.example");
    assert.equal(unratedHit.bias.known, false);

    assert.equal(r.result.knownSourceCount, 2);
    assert.ok(["broad", "moderate", "narrow"].includes(r.result.spectrumCoverage));

    // Pre-shaped for a direct pass-through into aggregateEvidence's evidence[] param.
    assert.equal(r.result.evidenceCandidates.length, 3);
    assert.deepEqual(Object.keys(r.result.evidenceCandidates[0]).sort(), ["sourceName", "sourceUrl", "stance", "text"].sort());

    const agg = call("aggregateEvidence", ctxA, {
      claim: "renewable energy capacity doubled",
      evidence: r.result.evidenceCandidates,
    });
    assert.equal(agg.ok, true);
    assert.equal(agg.result.sourceCount, 3);
  });

  it("returns a legitimate empty result (not an error) when GDELT has zero matches", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ articles: [] }) });
    const r = await call("discoverCoverage", ctxA, { claim: "an extremely obscure and specific niche claim" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.articles, []);
    assert.equal(r.result.spectrumCoverage, "no-coverage-found");
  });

  it("returns an honest failure on an HTTP error status, not fabricated articles", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await call("discoverCoverage", ctxA, { claim: "some claim" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "gdelt_unreachable");
  });
});
