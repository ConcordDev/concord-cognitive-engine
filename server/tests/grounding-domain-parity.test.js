// Contract tests for server/domains/grounding.js — fact-grounding macros.
// Covers the Ground News / fact-check parity surface: multi-source evidence
// aggregation, confidence rating, source bias labeling, audit trail,
// trending claims, shareable cards, and rebuttal linking.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGroundingActions from "../domains/grounding.js";

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
