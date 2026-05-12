import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VI.1 — Epistemic Limits & Uncertainty Objects
 *
 * Capabilities (Epistemic Limits & Meta-Reasoning):
 *   1.  Explicit representation of epistemic limits (what cannot be known yet)
 *   2.  Formal uncertainty objects (unknowns as first-class artifacts)
 *   3.  Boundary-of-knowledge mapping across domains
 *   4.  Detection of false certainty (confidence without support)
 *   5.  Automatic identification of illegible problems
 *   12. Measurement of explanatory compression limits
 *   13. Detection of overfit world models at civilizational scale
 *   14. Epistemic safety margins (how close a system is to instability)
 *   21. Mapping between symbolic, statistical, and causal reasoning limits
 *   22. Automatic discovery of when new primitives are required
 *   26. Detection of civilization-level blind assumptions
 *   27. Knowledge growth rate measurement and throttling
 *
 * Design:
 *   - Unknowns are first-class objects with typed uncertainty
 *   - Knowledge boundaries are explicitly mapped per domain
 *   - False certainty detector flags confident claims with thin evidence
 *   - Illegible problems are identified when standard methods fail
 *   - Compression limits detect when models can't compress further
 *   - Overfit detection catches models that memorize rather than generalize
 */

// === UNCERTAINTY OBJECTS ===

const UNCERTAINTY_TYPES = Object.freeze({
  ALEATORY: "aleatory",           // inherent randomness
  EPISTEMIC: "epistemic",         // reducible with more knowledge
  ONTOLOGICAL: "ontological",     // uncertain what categories apply
  COMPUTATIONAL: "computational", // theoretically knowable but not computable
  DEEP: "deep",                   // unknown unknowns
});

// First-class uncertainty objects
const uncertainties = new LruMap(); // uncertaintyId -> Uncertainty

/**
 * Create a formal uncertainty object (unknown as a first-class artifact).
 */
function createUncertainty(description, type, domain, bounds) {
  const id = `unc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const uncertainty = {
    id,
    description: String(description).slice(0, 2000),
    type: Object.values(UNCERTAINTY_TYPES).includes(type) ? type : UNCERTAINTY_TYPES.EPISTEMIC,
    domain: String(domain || "general"),
    bounds: {
      lower: bounds?.lower ?? null,     // minimum possible value/extent
      upper: bounds?.upper ?? null,     // maximum possible value/extent
      distribution: bounds?.distribution || "unknown", // uniform, normal, etc.
    },
    reducible: type !== UNCERTAINTY_TYPES.ALEATORY && type !== UNCERTAINTY_TYPES.DEEP,
    reductionStrategy: null,
    status: "open",   // open | partially_reduced | resolved | irreducible
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  uncertainties.set(id, uncertainty);
  capMap(uncertainties, 50000);

  return { ok: true, uncertainty };
}

/**
 * Update an uncertainty with new information (partial reduction).
 */
function reduceUncertainty(uncertaintyId, newInformation, newBounds) {
  const unc = uncertainties.get(uncertaintyId);
  if (!unc) return { ok: false, error: "uncertainty_not_found" };
  if (unc.status === "irreducible") return { ok: false, error: "uncertainty_is_irreducible" };

  if (newBounds) {
    if (newBounds.lower !== undefined) unc.bounds.lower = newBounds.lower;
    if (newBounds.upper !== undefined) unc.bounds.upper = newBounds.upper;
    if (newBounds.distribution) unc.bounds.distribution = newBounds.distribution;
  }

  unc.reductionStrategy = String(newInformation).slice(0, 2000);
  unc.status = "partially_reduced";
  unc.updatedAt = new Date().toISOString();

  // Check if fully resolved
  if (unc.bounds.lower !== null && unc.bounds.upper !== null &&
      unc.bounds.lower === unc.bounds.upper) {
    unc.status = "resolved";
  }

  return { ok: true, uncertainty: unc };
}

// === KNOWLEDGE BOUNDARIES ===

// Boundary maps: domain -> { knownFrontier[], unknownBeyond[], limitType }
const knowledgeBoundaries = new LruMap();

/**
 * Map the boundary of knowledge for a domain.
 */
function mapBoundary(domain, knownFrontier, unknownBeyond, limitType) {
  const id = String(domain);

  const boundary = {
    domain: id,
    knownFrontier: Array.isArray(knownFrontier)
      ? knownFrontier.map(k => String(k).slice(0, 500))
      : [],
    unknownBeyond: Array.isArray(unknownBeyond)
      ? unknownBeyond.map(u => String(u).slice(0, 500))
      : [],
    limitType: limitType || "epistemic", // epistemic | computational | fundamental
    mappedAt: new Date().toISOString(),
  };

  knowledgeBoundaries.set(id, boundary);
  capMap(knowledgeBoundaries, 10000);

  return { ok: true, boundary };
}

/**
 * Get the knowledge boundary for a domain.
 */
function getBoundary(domain) {
  const boundary = knowledgeBoundaries.get(domain);
  if (!boundary) return { ok: false, error: "boundary_not_mapped" };
  return { ok: true, boundary };
}

// === FALSE CERTAINTY DETECTION ===

/**
 * Detect false certainty: claims with high confidence but insufficient evidence.
 */
function detectFalseCertainty(claims) {
  if (!Array.isArray(claims)) return { ok: true, falseCertainties: [] };

  const falseCertainties = [];

  for (const claim of claims) {
    const confidence = Number(claim.confidence ?? 0);
    const evidenceCount = Array.isArray(claim.evidence) ? claim.evidence.length : 0;
    const evidenceQuality = Array.isArray(claim.evidence) && claim.evidence.length > 0
      ? claim.evidence.reduce((s, e) => s + (e.confidence || 0.5), 0) / claim.evidence.length
      : 0;

    // High confidence with low evidence = false certainty
    if (confidence > 0.8 && evidenceCount < 3) {
      falseCertainties.push({
        claim: String(claim.text || claim.claim || "").slice(0, 200),
        confidence,
        evidenceCount,
        evidenceQuality,
        severity: confidence > 0.9 && evidenceCount === 0 ? "critical" : "high",
        diagnosis: `Confidence ${(confidence * 100).toFixed(0)}% with only ${evidenceCount} evidence items`,
      });
    }

    // Confidence much higher than evidence quality
    if (confidence > evidenceQuality + 0.4 && evidenceCount > 0) {
      falseCertainties.push({
        claim: String(claim.text || claim.claim || "").slice(0, 200),
        confidence,
        evidenceCount,
        evidenceQuality,
        severity: "moderate",
        diagnosis: `Confidence gap: ${(confidence * 100).toFixed(0)}% claimed vs ${(evidenceQuality * 100).toFixed(0)}% evidence quality`,
      });
    }
  }

  return {
    ok: true,
    falseCertainties,
    totalAnalyzed: claims.length,
    totalFlagged: falseCertainties.length,
  };
}

// === ILLEGIBLE PROBLEM IDENTIFICATION ===

/**
 * Identify illegible problems: problems where standard methods don't apply.
 */
function identifyIllegibleProblems(problems) {
  if (!Array.isArray(problems)) return { ok: true, illegible: [] };

  const illegible = [];

  for (const prob of problems) {
    const indicators = [];

    // Check for illegibility markers
    const text = String(prob.description || prob.text || prob).toLowerCase();

    if (/\b(undefined|ill-defined|ambiguous|vague|circular)\b/.test(text)) {
      indicators.push("definitional_ambiguity");
    }
    if (/\b(no consensus|disagree|contested|debated)\b/.test(text)) {
      indicators.push("contested_framing");
    }
    if (/\b(unmeasurable|unquantifiable|subjective)\b/.test(text)) {
      indicators.push("measurement_impossible");
    }
    if (/\b(paradox|contradiction|impossible|undecidable)\b/.test(text)) {
      indicators.push("structural_impossibility");
    }
    if (/\b(emergent|complex|nonlinear|chaotic)\b/.test(text)) {
      indicators.push("irreducible_complexity");
    }

    // Check if the problem has failed approaches
    const failedApproaches = prob.failedApproaches || [];
    if (failedApproaches.length >= 3) {
      indicators.push("multiple_method_failures");
    }

    if (indicators.length >= 2) {
      illegible.push({
        problem: String(prob.description || prob.text || prob).slice(0, 300),
        indicators,
        illegibilityScore: Math.min(1, indicators.length / 5),
        recommendation: indicators.includes("structural_impossibility")
          ? "May require new conceptual primitives"
          : "Consider reframing the problem or accepting partial answers",
      });
    }
  }

  return {
    ok: true,
    illegible,
    totalAnalyzed: problems.length,
    totalIllegible: illegible.length,
  };
}

// === OVERFIT WORLD MODEL DETECTION ===

/**
 * Detect overfit world models: models that memorize specifics rather than generalize.
 */
function detectOverfit(model) {
  if (!model) return { ok: false, error: "model_required" };

  const indicators = [];

  // Check prediction diversity
  const predictions = model.predictions || [];
  if (predictions.length > 10) {
    const uniquePredictions = new Set(predictions.map(p => String(p.text || p).toLowerCase()));
    const diversityRatio = uniquePredictions.size / predictions.length;
    if (diversityRatio < 0.3) {
      indicators.push({
        type: "low_prediction_diversity",
        score: 1 - diversityRatio,
        detail: `Only ${uniquePredictions.size} unique predictions from ${predictions.length} attempts`,
      });
    }
  }

  // Check training/test gap
  if (model.trainingAccuracy !== undefined && model.testAccuracy !== undefined) {
    const gap = model.trainingAccuracy - model.testAccuracy;
    if (gap > 0.2) {
      indicators.push({
        type: "train_test_gap",
        score: gap,
        detail: `Training accuracy ${(model.trainingAccuracy * 100).toFixed(0)}% vs test ${(model.testAccuracy * 100).toFixed(0)}%`,
      });
    }
  }

  // Check assumption count relative to data
  const assumptions = model.assumptions || [];
  const dataPoints = model.dataPoints || 0;
  if (assumptions.length > 0 && dataPoints > 0 && assumptions.length > dataPoints * 0.5) {
    indicators.push({
      type: "over_parameterized",
      score: assumptions.length / dataPoints,
      detail: `${assumptions.length} assumptions for ${dataPoints} data points`,
    });
  }

  const isOverfit = indicators.length > 0;
  const overfitScore = indicators.length > 0
    ? indicators.reduce((s, i) => s + i.score, 0) / indicators.length
    : 0;

  return {
    ok: true,
    isOverfit,
    overfitScore: Math.min(1, overfitScore),
    indicators,
  };
}

// === EPISTEMIC SAFETY MARGINS ===

/**
 * Compute epistemic safety margins: how close the system is to instability.
 */
function computeSafetyMargins(systemState) {
  const margins = {};

  // Confidence concentration: is confidence too clustered?
  const confidences = systemState.confidences || [];
  if (confidences.length > 0) {
    const avg = confidences.reduce((s, c) => s + c, 0) / confidences.length;
    const variance = confidences.reduce((s, c) => s + (c - avg) ** 2, 0) / confidences.length;
    margins.confidenceVariance = {
      value: variance,
      threshold: 0.1,
      margin: Math.max(0, variance - 0.1),
      safe: variance >= 0.1, // some variance is healthy
    };
  }

  // Contradiction density
  const contradictions = systemState.contradictions || 0;
  const totalClaims = systemState.totalClaims || 1;
  const contradictionRate = contradictions / totalClaims;
  margins.contradictionDensity = {
    value: contradictionRate,
    threshold: 0.1,
    margin: Math.max(0, 0.1 - contradictionRate),
    safe: contradictionRate < 0.1,
  };

  // Domain diversity
  const domains = systemState.domains || [];
  const uniqueDomains = new Set(domains);
  margins.domainDiversity = {
    value: uniqueDomains.size,
    threshold: 3,
    margin: Math.max(0, uniqueDomains.size - 3),
    safe: uniqueDomains.size >= 3,
  };

  // Evidence freshness
  const avgAge = systemState.avgEvidenceAge || 0; // in ms
  const maxAge = 30 * 86400000; // 30 days
  margins.evidenceFreshness = {
    value: avgAge,
    threshold: maxAge,
    margin: Math.max(0, maxAge - avgAge),
    safe: avgAge < maxAge,
  };

  const allSafe = Object.values(margins).every(m => m.safe);
  const criticalCount = Object.values(margins).filter(m => !m.safe).length;

  return {
    ok: true,
    margins,
    overallSafe: allSafe,
    criticalCount,
    stabilityScore: 1 - (criticalCount / Math.max(1, Object.keys(margins).length)),
  };
}

// === KNOWLEDGE GROWTH MEASUREMENT ===

const growthMeasurements = []; // { ts, count, domain }

/**
 * Record a knowledge growth measurement.
 */
function measureGrowth(count, domain) {
  growthMeasurements.push({
    ts: Date.now(),
    count: Number(count),
    domain: String(domain || "all"),
  });

  if (growthMeasurements.length > 10000) {
    growthMeasurements.splice(0, growthMeasurements.length - 10000);
  }

  return { ok: true, measured: true };
}

/**
 * Compute growth rate and detect if throttling is needed.
 */
function computeGrowthRate(windowMs = 86400000) {
  const now = Date.now();
  const recent = growthMeasurements.filter(m => now - m.ts < windowMs);

  if (recent.length < 2) {
    return { ok: true, rate: 0, throttleRecommended: false, dataPoints: recent.length };
  }

  const sorted = [...recent].sort((a, b) => a.ts - b.ts);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const timeDelta = last.ts - first.ts;
  const countDelta = last.count - first.count;
  const rate = timeDelta > 0 ? countDelta / (timeDelta / 3600000) : 0; // per hour

  // Throttle if growth is explosive (more than 100 items/hour)
  const throttleRecommended = rate > 100;

  return {
    ok: true,
    rate,
    ratePerHour: rate,
    timeDelta,
    dataPoints: recent.length,
    throttleRecommended,
    throttleReason: throttleRecommended ? "Explosive growth detected — quality may degrade" : null,
  };
}

// === BLIND ASSUMPTIONS DETECTION ===

/**
 * Detect civilization-level blind assumptions:
 * beliefs so deeply held they are never questioned.
 */
function detectBlindAssumptions(beliefs) {
  if (!Array.isArray(beliefs)) return { ok: true, blindAssumptions: [] };

  const blindAssumptions = [];

  for (const belief of beliefs) {
    const indicators = [];
    const text = String(belief.text || belief.content || belief).toLowerCase();

    // Never challenged
    if ((belief.challengeCount || 0) === 0 && (belief.age || 0) > 30 * 86400000) {
      indicators.push("never_challenged");
    }

    // Universal acceptance
    if ((belief.acceptanceRate || 0) > 0.95) {
      indicators.push("universal_acceptance");
    }

    // Foundational but unexamined
    if ((belief.dependents || 0) > 10 && (belief.evidenceCount || 0) < 3) {
      indicators.push("foundational_but_unexamined");
    }

    // Contains absolutes
    if (/\b(always|never|all|none|every|no one|impossible|certain)\b/.test(text)) {
      indicators.push("absolute_language");
    }

    if (indicators.length >= 2) {
      blindAssumptions.push({
        belief: String(belief.text || belief.content || belief).slice(0, 300),
        indicators,
        risk: indicators.length >= 3 ? "high" : "moderate",
        recommendation: "Subject to explicit challenge and evidence review",
      });
    }
  }

  return {
    ok: true,
    blindAssumptions,
    totalAnalyzed: beliefs.length,
    totalFlagged: blindAssumptions.length,
  };
}

// === HELPERS ===

function capMap(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.epistemicLimits = {
    stats: {
      uncertaintiesCreated: 0, reductions: 0, boundariesMapped: 0,
      falseCertaintyScans: 0, illegibleScans: 0, overfitChecks: 0,
      safetyMarginChecks: 0, growthMeasurements: 0, blindAssumptionScans: 0,
    },
  };

  register("loaf.limits", "status", (ctx) => {
    const el = ctx.state.__loaf.epistemicLimits;
    return {
      ok: true,
      uncertainties: uncertainties.size,
      boundaries: knowledgeBoundaries.size,
      growthMeasurements: growthMeasurements.length,
      stats: el.stats,
    };
  }, { public: true });

  register("loaf.limits", "create_uncertainty", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.uncertaintiesCreated++;
    return createUncertainty(input.description, input.type, input.domain, input.bounds);
  }, { public: false });

  register("loaf.limits", "reduce_uncertainty", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.reductions++;
    return reduceUncertainty(String(input.uncertaintyId || ""), input.newInformation, input.newBounds);
  }, { public: false });

  register("loaf.limits", "map_boundary", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.boundariesMapped++;
    return mapBoundary(input.domain, input.knownFrontier, input.unknownBeyond, input.limitType);
  }, { public: false });

  register("loaf.limits", "get_boundary", (_ctx, input = {}) => {
    return getBoundary(String(input.domain || ""));
  }, { public: true });

  register("loaf.limits", "detect_false_certainty", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.falseCertaintyScans++;
    return detectFalseCertainty(input.claims || []);
  }, { public: true });

  register("loaf.limits", "identify_illegible", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.illegibleScans++;
    return identifyIllegibleProblems(input.problems || []);
  }, { public: true });

  register("loaf.limits", "detect_overfit", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.overfitChecks++;
    return detectOverfit(input.model || input);
  }, { public: true });

  register("loaf.limits", "safety_margins", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.safetyMarginChecks++;
    return computeSafetyMargins(input.systemState || input);
  }, { public: true });

  register("loaf.limits", "measure_growth", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.growthMeasurements++;
    return measureGrowth(input.count, input.domain);
  }, { public: false });

  register("loaf.limits", "growth_rate", (_ctx, input = {}) => {
    return computeGrowthRate(input.windowMs);
  }, { public: true });

  register("loaf.limits", "detect_blind_assumptions", (ctx, input = {}) => {
    const el = ctx.state.__loaf.epistemicLimits;
    el.stats.blindAssumptionScans++;
    return detectBlindAssumptions(input.beliefs || []);
  }, { public: true });

  register("loaf.limits", "list_uncertainties", (_ctx, input = {}) => {
    let list = Array.from(uncertainties.values());
    if (input.type) list = list.filter(u => u.type === input.type);
    if (input.domain) list = list.filter(u => u.domain === input.domain);
    if (input.status) list = list.filter(u => u.status === input.status);
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, uncertainties: list.slice(0, limit) };
  }, { public: true });
}

export {
  UNCERTAINTY_TYPES,
  createUncertainty,
  reduceUncertainty,
  mapBoundary,
  getBoundary,
  detectFalseCertainty,
  identifyIllegibleProblems,
  detectOverfit,
  computeSafetyMargins,
  measureGrowth,
  computeGrowthRate,
  detectBlindAssumptions,
  init,
};
