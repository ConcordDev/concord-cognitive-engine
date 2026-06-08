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

// ─────────────────────────────────────────────────────────────────────────────
// Wave top-up — uncovered BRANCHES of already-listed macros (exact-value
// verdict thresholds, neutral stances, cross-source consistency, interval
// boundaries, lookup-table edges). No bare-ok / typeof-only.
// ─────────────────────────────────────────────────────────────────────────────

describe("grounding — factCheck (uncovered stance + verdict branches)", () => {
  it("factCheck: irrelevant evidence (similarity < 0.1) is neutral → uncertain verdict", async () => {
    const r = await lensRun("grounding", "factCheck", {
      data: {
        claim: { text: "Quantum entanglement enables instant communication" },
        evidence: [
          { text: "Bananas are an excellent dietary source of potassium nutrients", reliability: 0.8 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.evaluations[0].stance, "neutral");
    assert.equal(r.result.breakdown.neutral.count, 1);
    assert.equal(r.result.breakdown.supporting.count, 0);
    assert.equal(r.result.breakdown.contradicting.count, 0);
    // totalScore === 0 → insufficient evidence verdict + zero confidence.
    assert.equal(r.result.verdict, "insufficient evidence");
    assert.equal(r.result.confidence, 0);
  });

  it("factCheck: mixed support + contradict evidence yields a sourceAgreementRate", async () => {
    const r = await lensRun("grounding", "factCheck", {
      data: {
        claim: { text: "Coffee improves long term memory retention" },
        evidence: [
          { text: "Trials confirmed coffee improves memory retention, verified and proven.", reliability: 0.9 },
          { text: "That coffee memory retention claim is false, debunked and misleading wrong.", reliability: 0.9 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.evidenceCount, 2);
    assert.equal(r.result.breakdown.supporting.count, 1);
    assert.equal(r.result.breakdown.contradicting.count, 1);
    // 1 supporting / (1 supporting + 1 contradicting) = 0.5
    assert.equal(r.result.sourceAgreementRate, 0.5);
  });
});

describe("grounding — aggregateEvidence (uncovered verdict thresholds)", () => {
  it("aggregateEvidence: all very-high supporting sources → probabilityTrue 1, likely true", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: {
        claim: "The result was reproduced",
        evidence: [
          { text: "Confirmed and verified", sourceUrl: "https://www.nature.com/a", stance: "supports" },
          { text: "Proven correct", sourceUrl: "https://science.org/b", stance: "supports" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.contradicting.count, 0);
    assert.equal(r.result.probabilityTrue, 1);   // conW === 0 → supW/supW
    assert.equal(r.result.verdict, "likely true");
    assert.equal(r.result.knownSourceCount, 2);
    // Both center (leanScore 0) → no spread → narrow coverage.
    assert.equal(r.result.leanSpread, 0);
    assert.equal(r.result.spectrumCoverage, "narrow");
  });

  it("aggregateEvidence: all contradicting sources → probabilityTrue 0, likely false", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: {
        claim: "The miracle cure works",
        evidence: [
          { text: "That is false and debunked", sourceUrl: "https://apnews.com/a", stance: "contradicts" },
          { text: "Proven a myth", sourceUrl: "https://reuters.com/b", stance: "contradicts" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.supporting.count, 0);
    assert.equal(r.result.probabilityTrue, 0);   // supW === 0
    assert.equal(r.result.verdict, "likely false");
  });

  it("aggregateEvidence: unrated source weights at neutral reliability + notes it", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: {
        claim: "An unrated outlet reported X",
        evidence: [
          { text: "An unrelated remark", sourceUrl: "https://my-random-blog.example/x", stance: "neutral" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.knownSourceCount, 0);
    // unrated: fact 0.5, rel 0.5 → weight 0.5
    assert.equal(r.result.citations[0].sourceWeight, 0.5);
    assert.equal(r.result.citations[0].bias.known, false);
    // totalW === 0 (no supporting/contradicting) → unverifiable
    assert.equal(r.result.verdict, "unverifiable");
    assert.equal(r.result.probabilityTrue, 0.5);
    assert.match(r.result.notes, /no published bias rating/i);
  });

  it("aggregateEvidence: substring-derived stance when no explicit stance given", async () => {
    const r = await lensRun("grounding", "aggregateEvidence", {
      params: {
        claim: "Vitamin C cures the common cold",
        evidence: [
          // contradict words (false, debunked) outnumber support words → contradicts
          { text: "This is false and has been debunked", sourceUrl: "https://cdc.gov/x" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].stance, "contradicts");
    assert.equal(r.result.breakdown.contradicting.count, 1);
  });
});

describe("grounding — confidenceRating (uncovered bands + interval boundary)", () => {
  it("confidenceRating: coin-flip prob + perfectly split evidence → inconclusive, wide interval", async () => {
    const r = await lensRun("grounding", "confidenceRating", {
      params: { probabilityTrue: 0.5, supporting: 1, contradicting: 1, neutral: 0, avgSourceWeight: 0.5 },
    });
    assert.equal(r.ok, true);
    // decisiveness = |0.5-0.5|*2 = 0 ; agreement = |1-1|/2 = 0
    assert.equal(r.result.factors.decisiveness, 0);
    assert.equal(r.result.factors.sourceAgreement, 0);
    // volume = 1 - e^(-2/4) = 0.393; conf = 0*0.4 + 0*0.25 + 0.393*0.2 + 0.5*0.15 = 0.154
    assert.equal(r.result.factors.evidenceVolume, 0.393);
    assert.equal(r.result.confidence, 0.154);
    assert.equal(r.result.confidenceBand, "inconclusive");
    assert.match(r.result.recommendation, /insufficient or conflicting/i);
  });

  it("confidenceRating: interval clamps to [0,1] when prob near the edge", async () => {
    const r = await lensRun("grounding", "confidenceRating", {
      params: { probabilityTrue: 0.98, supporting: 1, contradicting: 0, neutral: 0, avgSourceWeight: 0.5 },
    });
    assert.equal(r.ok, true);
    // margin computed, upper clamped at 1.
    assert.equal(r.result.interval.upper, 1);
    assert.ok(r.result.interval.lower >= 0 && r.result.interval.lower <= 0.98);
    assert.equal(r.result.probabilityTrue, 0.98);
  });

  it("confidenceRating: out-of-range probability is clamped into [0,1]", async () => {
    const r = await lensRun("grounding", "confidenceRating", {
      params: { probabilityTrue: 5, supporting: 4, contradicting: 0, neutral: 0, avgSourceWeight: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.probabilityTrue, 1); // clamped from 5
    assert.equal(r.result.factors.decisiveness, 1); // |1-0.5|*2
    assert.equal(r.result.factors.sourceAgreement, 1); // |4-0|/4
  });
});

describe("grounding — sourceBias (uncovered balance buckets)", () => {
  it("sourceBias: a pool of left-leaning sources reports skews left", async () => {
    const r = await lensRun("grounding", "sourceBias", {
      params: { sources: ["https://msnbc.com/a", "https://cnn.com/b"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ratedCount, 2);
    // avg of -4 (msnbc) and -3 (cnn) = -3.5
    assert.equal(r.result.aggregateLeanScore, -3.5);
    assert.equal(r.result.leanSpread, 1); // -3 .. -4
    assert.equal(r.result.balance, "skews left");
  });

  it("sourceBias: a single centered source reports centered", async () => {
    const r = await lensRun("grounding", "sourceBias", {
      params: { url: "https://reuters.com/story" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ratedCount, 1);
    assert.equal(r.result.aggregateLeanScore, 0);
    assert.equal(r.result.aggregateLean, "center");
    assert.equal(r.result.balance, "centered");
  });

  it("sourceBias: empty input is rejected", async () => {
    const r = await lensRun("grounding", "sourceBias", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /url or sources array/i);
  });
});

describe("grounding — sourceCredibility (cross-source consistency + recommendations)", () => {
  it("sourceCredibility: two sources with identical claims score full cross-consistency + diversify hint", async () => {
    const r = await lensRun("grounding", "sourceCredibility", {
      data: {
        sources: [
          { name: "JournalA", type: "peer-reviewed", claims: ["measured warming temperature trend rising globally"] },
          { name: "JournalB", type: "peer-reviewed", claims: ["measured warming temperature trend rising globally"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceCount, 2);
    // Identical claim words → full overlap → consistency 100 for each.
    assert.equal(r.result.sources[0].components.consistency, 100);
    assert.equal(r.result.sources[1].components.consistency, 100);
    // Both same type → diversify recommendation present.
    assert.ok(r.result.recommendations.some((rec) => rec.includes("diversifying source types")));
  });

  it("sourceCredibility: a heavily-biased low-authority forum is unreliable + triggers the 'replace' recommendation", async () => {
    const r = await lensRun("grounding", "sourceCredibility", {
      data: {
        sources: [
          // forum (authority 15) + many bias words drives biasScore down → composite < 40.
          { name: "Forum", type: "forum", claims: ["shocking outrageous bombshell — everyone always knows this, buy now, act now, exclusive"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    const s = r.result.sources[0];
    assert.equal(s.components.authority, 15); // forum
    assert.ok(s.credibilityScore < 40);
    assert.equal(s.credibilityLabel, "unreliable");
    assert.ok(r.result.recommendations.some((rec) => rec.includes("rated unreliable")));
    assert.equal(r.result.overallAssessment, "low reliability pool");
  });
});

describe("grounding — claimDecomposition (uncovered structure branches)", () => {
  it("claimDecomposition: 'if ... then' is a conditional structure", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: { claim: { text: "If interest rates rise then borrowing costs increase for households" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.logicalStructure, "conditional");
    assert.ok(r.result.connectives.some((c) => c.symbol === "IF"));
    assert.ok(r.result.connectives.some((c) => c.symbol === "THEN"));
  });

  it("claimDecomposition: contrastive 'but' splits and labels structure", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: { claim: { text: "The drug lowers blood pressure but causes drowsiness in patients" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.logicalStructure, "contrastive");
    assert.ok(r.result.connectives.some((c) => c.symbol === "BUT"));
    assert.equal(r.result.atomicClaimCount, 2);
  });

  it("claimDecomposition: components are scored against supplied evidence", async () => {
    const r = await lensRun("grounding", "claimDecomposition", {
      data: {
        claim: { text: "Exercise improves cardiovascular health significantly over time" },
        evidence: [
          { text: "Regular exercise improves cardiovascular health markers in long studies" },
        ],
      },
    });
    assert.equal(r.ok, true);
    const comp = r.result.components[0];
    assert.ok(comp.evaluation !== null);
    assert.equal(comp.evaluation.verdict, "supported");
    assert.ok(comp.evaluation.relevantEvidence >= 1);
    assert.equal(r.result.overallAssessment, "all components supported");
  });
});

describe("grounding — auditTrail + rebuttalsFor (uncovered list/clamp branches)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("grounding-trail-extra"); });

  it("auditTrail: empty trail reports zero checks + null avg probability", async () => {
    const t = await lensRun("grounding", "auditTrail", {}, ctx);
    assert.equal(t.ok, true);
    assert.equal(t.result.totalChecks, 0);
    assert.equal(t.result.checks.length, 0);
    assert.equal(t.result.stats.avgProbabilityTrue, null);
  });

  it("auditTrail: limit is clamped; verdict distribution + avg prob aggregate across checks", async () => {
    await lensRun("grounding", "recordCheck", { params: { claim: "claim one", verdict: "likely true", probabilityTrue: 0.8 } }, ctx);
    await lensRun("grounding", "recordCheck", { params: { claim: "claim two", verdict: "likely true", probabilityTrue: 0.6 } }, ctx);
    await lensRun("grounding", "recordCheck", { params: { claim: "claim three", verdict: "likely false", probabilityTrue: 0.2 } }, ctx);
    // limit 1 → only the newest check returned, but stats span ALL recorded.
    const t = await lensRun("grounding", "auditTrail", { params: { limit: 1 } }, ctx);
    assert.equal(t.result.totalChecks, 3);
    assert.equal(t.result.checks.length, 1);
    assert.equal(t.result.stats.verdictDistribution["likely true"], 2);
    assert.equal(t.result.stats.verdictDistribution["likely false"], 1);
    // (0.8 + 0.6 + 0.2) / 3 = 0.533
    assert.equal(t.result.stats.avgProbabilityTrue, 0.533);
  });

  it("rebuttalsFor: unfiltered list returns all rebuttals across checks", async () => {
    const rebCtx = await depthCtx("grounding-reb-all");
    const c1 = await lensRun("grounding", "recordCheck", { params: { claim: "first claim" } }, rebCtx);
    const c2 = await lensRun("grounding", "recordCheck", { params: { claim: "second claim" } }, rebCtx);
    await lensRun("grounding", "linkRebuttal", { params: { checkId: c1.result.recorded.id, counterClaim: "counter A" } }, rebCtx);
    await lensRun("grounding", "linkRebuttal", { params: { checkId: c2.result.recorded.id, counterClaim: "counter B" } }, rebCtx);
    const all = await lensRun("grounding", "rebuttalsFor", {}, rebCtx);
    assert.equal(all.ok, true);
    assert.equal(all.result.checkId, null);
    assert.equal(all.result.count, 2);
    // Filtered to one check → only its rebuttal.
    const one = await lensRun("grounding", "rebuttalsFor", { params: { checkId: c1.result.recorded.id } }, rebCtx);
    assert.equal(one.result.count, 1);
    assert.equal(one.result.rebuttals[0].counterClaim, "counter A");
  });

  it("linkRebuttal: defaults stance to 'rebuts' when an invalid stance is supplied", async () => {
    const defCtx = await depthCtx("grounding-reb-default");
    const c = await lensRun("grounding", "recordCheck", { params: { claim: "stance default claim" } }, defCtx);
    const reb = await lensRun("grounding", "linkRebuttal", {
      params: { checkId: c.result.recorded.id, counterClaim: "counter", stance: "not-a-real-stance" },
    }, defCtx);
    assert.equal(reb.ok, true);
    assert.equal(reb.result.rebuttal.stance, "rebuts");
  });

  it("linkRebuttal: rejects an empty counterClaim", async () => {
    const emptyCtx = await depthCtx("grounding-reb-empty");
    const c = await lensRun("grounding", "recordCheck", { params: { claim: "needs a counter" } }, emptyCtx);
    const bad = await lensRun("grounding", "linkRebuttal", { params: { checkId: c.result.recorded.id, counterClaim: "" } }, emptyCtx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /counterClaim text required/i);
  });
});

describe("grounding — factCheckCard (uncovered verdict color/emoji branches)", () => {
  it("factCheckCard: a false verdict renders red + cross emoji, no rating when unrated", async () => {
    const r = await lensRun("grounding", "factCheckCard", {
      params: { claim: "The earth is flat", verdict: "likely false", sources: ["https://nasa.gov/x"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.verdictColor, "#f43f5e"); // /false/ → red
    assert.equal(r.result.card.emoji, "❌");
    assert.equal(r.result.card.ratingLabel, "Not rated"); // no probabilityTrue
    assert.ok(r.result.card.shareText.includes("FACT-CHECK: LIKELY FALSE"));
    // Source name resolves from the bias table domain.
    assert.equal(r.result.card.sources[0].name, "nasa.gov");
  });

  it("factCheckCard: an uncertain verdict renders amber + warning emoji", async () => {
    const r = await lensRun("grounding", "factCheckCard", {
      params: { claim: "Aliens built the pyramids", verdict: "disputed", probabilityTrue: 0.4 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.verdictColor, "#eab308"); // neither true nor false → amber
    assert.equal(r.result.card.emoji, "⚠️");
    assert.equal(r.result.card.ratingLabel, "40% likely true");
  });
});
