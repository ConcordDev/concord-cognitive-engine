// tests/depth/grounding-behavior.test.js — REAL behavioral tests for the
// `grounding` domain (knowledge grounding / fact-checking lens;
// registerLensAction family, invoked via lensRun). Exact-value assertions on
// the deterministic fact-check / source-credibility / claim-decomposition
// compute, the published-table-driven evidence aggregation + confidence
// calibration + source-bias labeling, and the per-user STATE-backed
// record/audit/rebuttal CRUD round-trips + validation rejections.
//
// Two calling conventions in this domain:
//   - factCheck / sourceCredibility / claimDecomposition read `artifact.data`
//     → invoked with { data: {...} }.
//   - aggregateEvidence / confidenceRating / sourceBias / recordCheck /
//     auditTrail / linkRebuttal / rebuttalsFor read `params`
//     → invoked with { params: {...} } and a shared ctx for user-scoped STATE.
//
// SKIPPED — network macro that fails under no-egress: `trendingClaims`
// (Wikimedia featured-content REST fetch). All deterministic logic is covered.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("grounding — factCheck (deterministic stance + verdict)", () => {
  it("factCheck: support-word evidence yields supporting verdict", async () => {
    const r = await lensRun("grounding", "factCheck", {
      data: {
        claim: { text: "The vaccine reduces hospitalization" },
        evidence: [
          { text: "Studies confirmed the vaccine reduces hospitalization, verified by trials.", reliability: 0.9 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.evidenceCount, 1);
    assert.equal(r.result.breakdown.supporting.count, 1);
    assert.equal(r.result.breakdown.contradicting.count, 0);
    assert.equal(r.result.direction, "supporting");
    assert.equal(r.result.evaluations[0].stance, "supports");
  });

  it("factCheck: contradict-word evidence flips direction to contradicting", async () => {
    // NB: the handler matches support/contradict words by substring, so
    // "incorrect" would spuriously fire the "correct" support word. Use clean
    // contradiction tokens (false / debunked / misleading / wrong).
    const r = await lensRun("grounding", "factCheck", {
      data: {
        claim: { text: "The earth is flat shaped planet" },
        evidence: [
          { text: "That flat earth planet shaped claim is false, debunked and misleading wrong.", reliability: 0.9 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.contradicting.count, 1);
    assert.equal(r.result.direction, "contradicting");
    assert.equal(r.result.verdict, "likely false");
    assert.equal(r.result.evaluations[0].stance, "contradicts");
  });

  it("factCheck: no evidence → unverifiable verdict (boundary)", async () => {
    const r = await lensRun("grounding", "factCheck", {
      data: { claim: { text: "Some claim" }, evidence: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "unverifiable");
  });
});

describe("grounding — sourceCredibility (authority/recency composite)", () => {
  it("sourceCredibility: peer-reviewed outranks a forum post (sorted desc)", async () => {
    const r = await lensRun("grounding", "sourceCredibility", {
      data: {
        sources: [
          { name: "RandoForum", type: "forum", claims: ["everyone always says shocking things"] },
          { name: "JournalX", type: "peer-reviewed", claims: ["measured effect at p<0.05"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceCount, 2);
    // sorted by credibilityScore desc → peer-reviewed first
    assert.equal(r.result.sources[0].name, "JournalX");
    assert.equal(r.result.sources[0].components.authority, 95);
    assert.equal(r.result.sources[1].name, "RandoForum");
    assert.equal(r.result.sources[1].components.authority, 15);
    assert.ok(r.result.sources[0].credibilityScore > r.result.sources[1].credibilityScore);
  });

  it("sourceCredibility: bias words detected per category", async () => {
    const r = await lensRun("grounding", "sourceCredibility", {
      data: {
        sources: [
          { name: "Tabloid", type: "blog", claims: ["This shocking bombshell will always devastate everyone — buy now!"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    const s = r.result.sources[0];
    // substring matching: "shocking","bombshell" = emotional 2 ("devastate" ≠ list "devastating");
    // "always","everyone","all" (substring of "always") = absolutist 3; "buy" = promotional 1
    assert.equal(s.biasIndicators.emotional, 2);
    assert.equal(s.biasIndicators.absolutist, 3);
    assert.equal(s.biasIndicators.promotional, 1);
    assert.equal(s.credibilityLabel, "unreliable");
  });
});

describe("grounding — claimDecomposition (atomic split + logical structure)", () => {
  it("claimDecomposition: 'X and Y' splits into 2 atomic claims, compound structure", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: { claim: { text: "Coffee improves alertness and chocolate raises mood significantly" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.atomicClaimCount, 2);
    assert.equal(r.result.logicalStructure, "compound");
    assert.ok(r.result.connectives.some((c) => c.symbol === "AND"));
  });

  it("claimDecomposition: causal 'because' → causal-chain structure", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: { claim: { text: "The ice melted because temperatures rose sharply" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.logicalStructure, "causal-chain");
    assert.ok(r.result.connectives.some((c) => c.symbol === "BECAUSE"));
  });

  it("claimDecomposition: quantitative component is classified as quantitative", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: { claim: { text: "Sales grew by 40 percent last quarter overall" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.logicalStructure, "simple");
    assert.ok(r.result.components.some((c) => c.claimType === "quantitative"));
  });
});

describe("grounding — aggregateEvidence (weighted, table-driven verdict)", () => {
  it("aggregateEvidence: weights known sources, computes probabilityTrue + lean spread", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: {
        claim: "The treatment is effective",
        evidence: [
          { text: "Trials confirmed it works", sourceUrl: "https://reuters.com/x", stance: "supports" },
          { text: "Verified effective", sourceUrl: "https://www.nature.com/y", stance: "supports" },
          { text: "Some doubt remains", sourceUrl: "https://foxnews.com/z", stance: "contradicts" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceCount, 3);
    assert.equal(r.result.knownSourceCount, 3);
    assert.equal(r.result.breakdown.supporting.count, 2);
    assert.equal(r.result.breakdown.contradicting.count, 1);
    // supW = 0.892 + 0.988 = 1.88 ; conW = 0.648 ; probTrue = 1.88/2.528
    assert.equal(r.result.probabilityTrue, 0.744);
    assert.equal(r.result.verdict, "leans true");
    assert.equal(r.result.leanSpread, 3); // reuters 0, nature 0, fox 3
    assert.equal(r.result.spectrumCoverage, "moderate");
  });

  it("aggregateEvidence: rejects empty evidence", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: { claim: "x", evidence: [] },
    });
    // lens.run wraps the handler's {ok:false,error} under a success envelope.
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /evidence item required/i);
  });
});

describe("grounding — confidenceRating (calibrated confidence + interval)", () => {
  it("confidenceRating: lopsided, high-prob evidence → high confidence band + interval", async () => {
    const r = await lensRun("grounding", "confidenceRating", {
      params: { probabilityTrue: 0.9, supporting: 3, contradicting: 0, neutral: 1, avgSourceWeight: 0.85 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.confidence, 0.824);
    assert.equal(r.result.confidenceBand, "high confidence");
    assert.equal(r.result.factors.decisiveness, 0.8);
    assert.equal(r.result.factors.sourceAgreement, 1);
    assert.equal(r.result.interval.margin, 0.092);
    assert.equal(r.result.interval.lower, 0.808);
    assert.equal(r.result.interval.upper, 0.992);
  });

  it("confidenceRating: rejects zero evidence counts", async () => {
    const r = await lensRun("grounding", "confidenceRating", {
      params: { probabilityTrue: 0.5, supporting: 0, contradicting: 0, neutral: 0 },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /evidence counts required/i);
  });
});

describe("grounding — sourceBias (published lean/reliability lookup)", () => {
  it("sourceBias: labels a known domain + parent-domain match, computes spread", async () => {
    const r = await lensRun("grounding", "sourceBias", {
      params: { sources: ["https://edition.cnn.com/story", "https://www.foxnews.com/a", "https://apnews.com/b"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ratedCount, 3);
    const cnn = r.result.sources.find((s) => s.domain === "cnn.com");
    assert.equal(cnn.lean, "left");       // parent-domain match edition.cnn.com → cnn.com
    assert.equal(cnn.leanScore, -3);
    const fox = r.result.sources.find((s) => s.domain === "foxnews.com");
    assert.equal(fox.leanScore, 3);
    assert.equal(r.result.leanSpread, 6); // -3 (cnn) .. 3 (fox)
    assert.equal(r.result.balance, "balanced (spans the spectrum)");
  });

  it("sourceBias: unrated domain reported with rated=false", async () => {
    const r = await lensRun("grounding", "sourceBias", {
      params: { url: "https://some-random-blog.example/post" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sources[0].rated, false);
    assert.equal(r.result.sources[0].lean, "unrated");
  });
});

describe("grounding — record/audit/rebuttal CRUD round-trips", () => {
  it("recordCheck → auditTrail round-trip + linkRebuttal thread", async () => {
    const ctx = await depthCtx("grounding-crud");

    const rec = await lensRun("grounding", "recordCheck", {
      params: {
        claim: "Tea contains caffeine",
        verdict: "likely true",
        probabilityTrue: 0.85,
        confidence: 0.7,
        sourceCount: 2,
        sources: ["https://nature.com/a", "https://who.int/b"],
      },
    }, ctx);
    assert.equal(rec.ok, true);
    assert.equal(rec.result.recorded.claim, "Tea contains caffeine");
    assert.equal(rec.result.recorded.verdict, "likely true");
    assert.equal(rec.result.recorded.probabilityTrue, 0.85);
    assert.equal(rec.result.recorded.sources.length, 2);
    const checkId = rec.result.recorded.id;

    const trail = await lensRun("grounding", "auditTrail", { params: { limit: 50 } }, ctx);
    assert.equal(trail.ok, true);
    assert.equal(trail.result.totalChecks, 1);
    assert.ok(trail.result.checks.some((c) => c.id === checkId));
    assert.equal(trail.result.stats.verdictDistribution["likely true"], 1);
    assert.equal(trail.result.stats.avgProbabilityTrue, 0.85);

    const reb = await lensRun("grounding", "linkRebuttal", {
      params: { checkId, counterClaim: "Herbal teas are caffeine-free", stance: "qualifies" },
    }, ctx);
    assert.equal(reb.ok, true);
    assert.equal(reb.result.rebuttal.checkId, checkId);
    assert.equal(reb.result.rebuttal.stance, "qualifies");
    assert.equal(reb.result.rebuttal.originalClaim, "Tea contains caffeine");

    const list = await lensRun("grounding", "rebuttalsFor", { params: { checkId } }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.ok(list.result.rebuttals.some((x) => x.id === reb.result.rebuttal.id));
  });

  it("linkRebuttal: rejects unknown checkId", async () => {
    const ctx = await depthCtx("grounding-crud-reject");
    const r = await lensRun("grounding", "linkRebuttal", {
      params: { checkId: "check_does_not_exist", counterClaim: "anything" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not found/i);
  });

  it("recordCheck: rejects empty claim", async () => {
    const ctx = await depthCtx("grounding-crud-empty");
    const r = await lensRun("grounding", "recordCheck", { params: { claim: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /claim text required/i);
  });
});

describe("grounding — factCheckCard (shareable card builder)", () => {
  it("factCheckCard: builds card with verdict color + rating label + shareText", async () => {
    const r = await lensRun("grounding", "factCheckCard", {
      params: {
        claim: "Water boils at 100C at sea level",
        verdict: "likely true",
        probabilityTrue: 0.95,
        confidence: 0.8,
        sources: ["https://nature.com/x"],
        summary: "Standard atmospheric pressure.",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.verdictColor, "#22c55e"); // /true/ → green
    assert.equal(r.result.card.emoji, "✅");
    assert.equal(r.result.card.ratingLabel, "95% likely true");
    assert.equal(r.result.card.sourceCount, 1);
    assert.ok(r.result.card.shareText.includes("FACT-CHECK: LIKELY TRUE"));
  });

  it("factCheckCard: rejects missing claim", async () => {
    const r = await lensRun("grounding", "factCheckCard", { params: { verdict: "likely true" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /claim text required/i);
  });
});
