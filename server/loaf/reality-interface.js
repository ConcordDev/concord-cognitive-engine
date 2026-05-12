import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VII.1 — Reality Interface & Feedback Systems
 *
 * Capabilities (Reality-Grounded Epistemics):
 *   1.  Explicit modeling of reality–model mismatch
 *   2.  Tracking of where abstractions break down in practice
 *   3.  Reality feedback loops (real-world outcomes correcting epistemics)
 *   4.  Error attribution across layers (model vs assumption vs environment)
 *   5.  Measurement of intervention impact vs prediction confidence
 *   6.  Detection of Goodhart pressure before collapse
 *   7.  Separation of descriptive truth from actionable truth
 *   10. Reality-anchored validation pipelines
 *   11. Differentiation between knowing, predicting, and acting
 *
 * Design:
 *   - Models carry explicit mismatch records against observed reality
 *   - Abstractions track their breakdown conditions
 *   - Feedback loops continuously correct epistemic claims from outcomes
 *   - Errors are attributed to specific layers: model, assumption, or environment
 *   - Goodhart pressure is detected before metrics become targets
 *   - Descriptive truth (what is) is separated from actionable truth (what to do)
 */

// === REALITY-MODEL MISMATCH ===

const MISMATCH_TYPES = Object.freeze({
  PREDICTION_ERROR: "prediction_error",     // model predicted X, reality was Y
  ABSTRACTION_LEAK: "abstraction_leak",     // abstraction doesn't hold in practice
  ASSUMPTION_VIOLATED: "assumption_violated", // underlying assumption was wrong
  ENVIRONMENT_SHIFT: "environment_shift",   // environment changed, model didn't
  SCALE_BREAKDOWN: "scale_breakdown",       // works at one scale, fails at another
});

const ERROR_LAYERS = Object.freeze({
  MODEL: "model",
  ASSUMPTION: "assumption",
  ENVIRONMENT: "environment",
  MEASUREMENT: "measurement",
  INTERPRETATION: "interpretation",
});

// mismatchId -> { type, prediction, reality, attribution, severity }
const mismatches = new LruMap();

/**
 * Record a reality-model mismatch.
 */
function recordMismatch(prediction, reality, type, modelId) {
  const id = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const mismatch = {
    id,
    type: Object.values(MISMATCH_TYPES).includes(type) ? type : MISMATCH_TYPES.PREDICTION_ERROR,
    prediction: {
      value: prediction.value ?? null,
      description: String(prediction.description || prediction).slice(0, 2000),
      confidence: Math.max(0, Math.min(1, Number(prediction.confidence ?? 0.5))),
    },
    reality: {
      value: reality.value ?? null,
      description: String(reality.description || reality).slice(0, 2000),
      observedAt: new Date().toISOString(),
    },
    modelId: String(modelId || "unknown"),
    magnitude: null,
    attribution: null,
    correctionApplied: false,
    createdAt: new Date().toISOString(),
  };

  // Compute mismatch magnitude if values are numeric
  if (typeof mismatch.prediction.value === "number" && typeof mismatch.reality.value === "number") {
    const diff = Math.abs(mismatch.prediction.value - mismatch.reality.value);
    const scale = Math.max(Math.abs(mismatch.prediction.value), Math.abs(mismatch.reality.value), 1);
    mismatch.magnitude = diff / scale;
  }

  mismatches.set(id, mismatch);
  capMap(mismatches, 50000);

  return { ok: true, mismatch };
}

/**
 * Attribute an error to a specific layer.
 */
function attributeError(mismatchId, layer, explanation) {
  const mm = mismatches.get(mismatchId);
  if (!mm) return { ok: false, error: "mismatch_not_found" };

  mm.attribution = {
    layer: Object.values(ERROR_LAYERS).includes(layer) ? layer : ERROR_LAYERS.MODEL,
    explanation: String(explanation).slice(0, 2000),
    attributedAt: new Date().toISOString(),
  };

  return { ok: true, mismatch: mm };
}

/**
 * Aggregate error attribution statistics across all mismatches.
 */
function errorAttributionSummary() {
  const byLayer = {};
  const byType = {};
  let totalAttributed = 0;

  for (const [, mm] of mismatches) {
    if (mm.attribution) {
      totalAttributed++;
      const layer = mm.attribution.layer;
      byLayer[layer] = (byLayer[layer] || 0) + 1;
    }
    byType[mm.type] = (byType[mm.type] || 0) + 1;
  }

  return {
    total: mismatches.size,
    totalAttributed,
    byLayer,
    byType,
    unattributed: mismatches.size - totalAttributed,
  };
}

// === ABSTRACTION BREAKDOWN TRACKING ===

// abstractionId -> { name, conditions, breakdowns[] }
const abstractions = new LruMap();

/**
 * Register an abstraction with its validity conditions.
 */
function registerAbstraction(name, domain, validityConditions) {
  const id = `abs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const abstraction = {
    id,
    name: String(name).slice(0, 200),
    domain: String(domain || "general"),
    validityConditions: Array.isArray(validityConditions)
      ? validityConditions.map(c => String(c).slice(0, 500))
      : [],
    breakdowns: [],
    breakdownCount: 0,
    status: "valid", // valid | degraded | broken
    createdAt: new Date().toISOString(),
  };

  abstractions.set(id, abstraction);
  capMap(abstractions, 10000);
  return { ok: true, abstraction };
}

/**
 * Record a breakdown of an abstraction in practice.
 */
function recordBreakdown(abstractionId, context, failedCondition) {
  const abs = abstractions.get(abstractionId);
  if (!abs) return { ok: false, error: "abstraction_not_found" };

  abs.breakdowns.push({
    context: String(context).slice(0, 1000),
    failedCondition: String(failedCondition).slice(0, 500),
    recordedAt: new Date().toISOString(),
  });
  if (abs.breakdowns.length > 100) abs.breakdowns.splice(0, abs.breakdowns.length - 100);

  abs.breakdownCount++;
  abs.status = abs.breakdownCount >= 5 ? "broken" : abs.breakdownCount >= 2 ? "degraded" : "valid";

  return { ok: true, abstraction: abs };
}

// === REALITY FEEDBACK LOOPS ===

// feedbackId -> { claim, prediction, outcome, correction }
const feedbackLoops = new LruMap();

/**
 * Create a reality feedback loop: connect a prediction to its outcome.
 */
function createFeedbackLoop(claimId, prediction, domain) {
  const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const loop = {
    id,
    claimId: String(claimId || ""),
    prediction: String(prediction).slice(0, 2000),
    domain: String(domain || "general"),
    outcome: null,
    correction: null,
    status: "awaiting_outcome", // awaiting_outcome | outcome_recorded | corrected
    createdAt: new Date().toISOString(),
  };

  feedbackLoops.set(id, loop);
  capMap(feedbackLoops, 50000);
  return { ok: true, feedbackLoop: loop };
}

/**
 * Record the real-world outcome for a feedback loop.
 */
function recordOutcome(feedbackId, outcome, matchesPrediction) {
  const loop = feedbackLoops.get(feedbackId);
  if (!loop) return { ok: false, error: "feedback_loop_not_found" };

  loop.outcome = {
    description: String(outcome).slice(0, 2000),
    matchesPrediction: Boolean(matchesPrediction),
    observedAt: new Date().toISOString(),
  };
  loop.status = "outcome_recorded";

  return { ok: true, feedbackLoop: loop };
}

/**
 * Apply a correction based on feedback (closes the loop).
 */
function applyCorrection(feedbackId, correction) {
  const loop = feedbackLoops.get(feedbackId);
  if (!loop) return { ok: false, error: "feedback_loop_not_found" };
  if (!loop.outcome) return { ok: false, error: "no_outcome_recorded" };

  loop.correction = {
    description: String(correction).slice(0, 2000),
    appliedAt: new Date().toISOString(),
  };
  loop.status = "corrected";

  return { ok: true, feedbackLoop: loop };
}

// === GOODHART PRESSURE DETECTION ===

// metricId -> { name, values[], target, pressureScore }
const monitoredMetrics = new LruMap();

/**
 * Monitor a metric for Goodhart pressure (when a measure becomes a target).
 */
function monitorMetric(name, target, domain) {
  const id = `met_${String(name).toLowerCase().replace(/\s+/g, "_")}`;

  if (!monitoredMetrics.has(id)) {
    monitoredMetrics.set(id, {
      id,
      name: String(name).slice(0, 200),
      domain: String(domain || "general"),
      target: target ?? null,
      values: [],
      pressureScore: 0,
      status: "healthy", // healthy | pressured | collapsed
      createdAt: new Date().toISOString(),
    });
  }

  capMap(monitoredMetrics, 10000);
  return { ok: true, metric: monitoredMetrics.get(id) };
}

/**
 * Record a metric value and check for Goodhart pressure.
 */
function recordMetricValue(metricId, value, context) {
  const metric = monitoredMetrics.get(metricId);
  if (!metric) return { ok: false, error: "metric_not_found" };

  metric.values.push({
    value: Number(value),
    context: String(context || "").slice(0, 500),
    recordedAt: Date.now(),
  });
  if (metric.values.length > 500) metric.values.splice(0, metric.values.length - 500);

  // Detect Goodhart pressure: metric converging on target suspiciously fast
  // or with decreasing variance (gaming)
  if (metric.target !== null && metric.values.length >= 10) {
    const recent = metric.values.slice(-10);
    const recentValues = recent.map(v => v.value);

    // Check if values are converging unnaturally on target
    const distances = recentValues.map(v => Math.abs(v - metric.target));
    const isConverging = distances[0] > distances[distances.length - 1];

    // Check for decreasing variance (sign of gaming)
    const firstHalf = recentValues.slice(0, 5);
    const secondHalf = recentValues.slice(5);
    const variance = arr => {
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
      return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    };
    const varDecrease = variance(firstHalf) > variance(secondHalf) * 2;

    if (isConverging && varDecrease) {
      metric.pressureScore = Math.min(1, metric.pressureScore + 0.2);
    }

    metric.status = metric.pressureScore >= 0.8 ? "collapsed"
      : metric.pressureScore >= 0.4 ? "pressured"
      : "healthy";
  }

  return {
    ok: true,
    value: Number(value),
    pressureScore: metric.pressureScore,
    status: metric.status,
  };
}

/**
 * Detect Goodhart pressure across all monitored metrics.
 */
function detectGoodhartPressure() {
  const pressured = [];
  for (const [, metric] of monitoredMetrics) {
    if (metric.pressureScore > 0.3) {
      pressured.push({
        id: metric.id,
        name: metric.name,
        pressureScore: metric.pressureScore,
        status: metric.status,
        valueCount: metric.values.length,
      });
    }
  }
  return {
    ok: true,
    pressured: pressured.sort((a, b) => b.pressureScore - a.pressureScore),
    totalMonitored: monitoredMetrics.size,
    totalPressured: pressured.length,
  };
}

// === TRUTH TYPE SEPARATION ===

const TRUTH_KINDS = Object.freeze({
  DESCRIPTIVE: "descriptive",   // what IS
  PREDICTIVE: "predictive",     // what WILL BE
  ACTIONABLE: "actionable",     // what to DO
});

// truthId -> { kind, content, linkedActions[] }
const typedTruths = new LruMap();

/**
 * Register a truth with explicit kind differentiation.
 */
function registerTypedTruth(content, kind, domain, linkedActions) {
  const id = `tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const truth = {
    id,
    content: String(content).slice(0, 2000),
    kind: Object.values(TRUTH_KINDS).includes(kind) ? kind : TRUTH_KINDS.DESCRIPTIVE,
    domain: String(domain || "general"),
    linkedActions: Array.isArray(linkedActions)
      ? linkedActions.map(a => String(a).slice(0, 500))
      : [],
    createdAt: new Date().toISOString(),
  };

  typedTruths.set(id, truth);
  capMap(typedTruths, 50000);
  return { ok: true, truth };
}

// === INTERVENTION IMPACT MEASUREMENT ===

/**
 * Measure intervention impact relative to prediction confidence.
 * Flags cases where high-confidence predictions led to low-impact interventions.
 */
function measureInterventionImpact(interventions) {
  if (!Array.isArray(interventions)) return { ok: true, results: [] };

  const results = interventions.map(iv => {
    const predConf = Math.max(0, Math.min(1, Number(iv.predictionConfidence ?? 0.5)));
    const actualImpact = Math.max(0, Math.min(1, Number(iv.actualImpact ?? 0)));
    const gap = predConf - actualImpact;

    return {
      description: String(iv.description || "").slice(0, 300),
      predictionConfidence: predConf,
      actualImpact,
      gap,
      overconfident: gap > 0.3,
      category: gap > 0.3 ? "overconfident_intervention"
        : gap < -0.3 ? "surprising_success"
        : "calibrated",
    };
  });

  return {
    ok: true,
    results,
    overconfidentCount: results.filter(r => r.overconfident).length,
    calibratedCount: results.filter(r => r.category === "calibrated").length,
    avgGap: results.length > 0 ? results.reduce((s, r) => s + r.gap, 0) / results.length : 0,
  };
}

// === REALITY-ANCHORED VALIDATION PIPELINE ===

/**
 * Run a validation pipeline that anchors claims against observed reality.
 */
function validateAgainstReality(claims, observations) {
  if (!Array.isArray(claims) || !Array.isArray(observations)) {
    return { ok: true, results: [], reason: "need_both_claims_and_observations" };
  }

  const results = [];

  for (const claim of claims) {
    const claimText = String(claim.text || claim).toLowerCase();
    const matchingObs = observations.filter(obs => {
      const obsText = String(obs.text || obs).toLowerCase();
      const claimWords = new Set(claimText.split(/\s+/).filter(w => w.length > 3));
      const obsWords = new Set(obsText.split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const w of claimWords) if (obsWords.has(w)) overlap++;
      return overlap >= 2;
    });

    const validated = matchingObs.length > 0;
    const supports = matchingObs.filter(o => !String(o.text || o).toLowerCase().includes("not")).length;
    const contradicts = matchingObs.length - supports;

    results.push({
      claim: String(claim.text || claim).slice(0, 200),
      validated,
      observationMatches: matchingObs.length,
      supports,
      contradicts,
      verdict: contradicts > supports ? "contradicted" : supports > 0 ? "supported" : "unvalidated",
    });
  }

  return {
    ok: true,
    results,
    totalValidated: results.filter(r => r.validated).length,
    totalContradicted: results.filter(r => r.verdict === "contradicted").length,
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
  STATE.__loaf.realityInterface = {
    stats: {
      mismatchesRecorded: 0, attributions: 0, abstractionsRegistered: 0,
      breakdowns: 0, feedbackLoops: 0, outcomes: 0, corrections: 0,
      metricsMonitored: 0, goodhartScans: 0, typedTruths: 0,
      interventionMeasurements: 0, validations: 0,
    },
  };

  register("loaf.reality", "status", (ctx) => {
    const ri = ctx.state.__loaf.realityInterface;
    return {
      ok: true,
      mismatches: mismatches.size,
      abstractions: abstractions.size,
      feedbackLoops: feedbackLoops.size,
      monitoredMetrics: monitoredMetrics.size,
      typedTruths: typedTruths.size,
      errorAttribution: errorAttributionSummary(),
      stats: ri.stats,
    };
  }, { public: true });

  register("loaf.reality", "record_mismatch", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.mismatchesRecorded++;
    return recordMismatch(input.prediction || {}, input.reality || {}, input.type, input.modelId);
  }, { public: false });

  register("loaf.reality", "attribute_error", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.attributions++;
    return attributeError(String(input.mismatchId || ""), input.layer, input.explanation);
  }, { public: false });

  register("loaf.reality", "register_abstraction", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.abstractionsRegistered++;
    return registerAbstraction(input.name, input.domain, input.validityConditions);
  }, { public: false });

  register("loaf.reality", "record_breakdown", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.breakdowns++;
    return recordBreakdown(String(input.abstractionId || ""), input.context, input.failedCondition);
  }, { public: false });

  register("loaf.reality", "create_feedback_loop", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.feedbackLoops++;
    return createFeedbackLoop(input.claimId, input.prediction, input.domain);
  }, { public: false });

  register("loaf.reality", "record_outcome", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.outcomes++;
    return recordOutcome(String(input.feedbackId || ""), input.outcome, input.matchesPrediction);
  }, { public: false });

  register("loaf.reality", "apply_correction", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.corrections++;
    return applyCorrection(String(input.feedbackId || ""), input.correction);
  }, { public: false });

  register("loaf.reality", "monitor_metric", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.metricsMonitored++;
    return monitorMetric(input.name, input.target, input.domain);
  }, { public: false });

  register("loaf.reality", "record_metric_value", (_ctx, input = {}) => {
    return recordMetricValue(String(input.metricId || ""), input.value, input.context);
  }, { public: false });

  register("loaf.reality", "detect_goodhart", (ctx) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.goodhartScans++;
    return detectGoodhartPressure();
  }, { public: true });

  register("loaf.reality", "register_typed_truth", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.typedTruths++;
    return registerTypedTruth(input.content, input.kind, input.domain, input.linkedActions);
  }, { public: false });

  register("loaf.reality", "measure_intervention_impact", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.interventionMeasurements++;
    return measureInterventionImpact(input.interventions || []);
  }, { public: true });

  register("loaf.reality", "validate_against_reality", (ctx, input = {}) => {
    const ri = ctx.state.__loaf.realityInterface;
    ri.stats.validations++;
    return validateAgainstReality(input.claims || [], input.observations || []);
  }, { public: true });

  register("loaf.reality", "error_summary", (_ctx) => {
    return { ok: true, ...errorAttributionSummary() };
  }, { public: true });

  register("loaf.reality", "list_mismatches", (_ctx, input = {}) => {
    let list = Array.from(mismatches.values());
    if (input.type) list = list.filter(m => m.type === input.type);
    return { ok: true, mismatches: list.slice(-(Number(input.limit || 50))) };
  }, { public: true });

  register("loaf.reality", "list_feedback_loops", (_ctx, input = {}) => {
    let list = Array.from(feedbackLoops.values());
    if (input.status) list = list.filter(l => l.status === input.status);
    return { ok: true, feedbackLoops: list.slice(-(Number(input.limit || 50))) };
  }, { public: true });
}

export {
  MISMATCH_TYPES,
  ERROR_LAYERS,
  TRUTH_KINDS,
  recordMismatch,
  attributeError,
  errorAttributionSummary,
  registerAbstraction,
  recordBreakdown,
  createFeedbackLoop,
  recordOutcome,
  applyCorrection,
  monitorMetric,
  recordMetricValue,
  detectGoodhartPressure,
  registerTypedTruth,
  measureInterventionImpact,
  validateAgainstReality,
  init,
};
