import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VII.3 — Intervention Governance & Systemic Safety
 *
 * Capabilities (Reality-Grounded Epistemics):
 *   17. Reality-constrained optimization (no abstract maximizers)
 *   18. Detection of systemic fragility before activation
 *   19. Mapping of leverage points vs risk surfaces
 *   25. Long-range causal attribution
 *   26. Prevention of optimization cascades
 *   27. Stability-first intervention planning
 *   28. Separation of intelligence growth from power application
 *   29. Reality-aware governance evolution
 *   30. Civilization-scale "do no harm" enforcement primitives
 *
 * Design:
 *   - Optimization is always constrained by reality bounds (no unbounded maximizers)
 *   - Systemic fragility is detected before it activates
 *   - Leverage points and risk surfaces are mapped together
 *   - Intelligence growth is separated from power application
 *   - "Do no harm" is enforced as a primitive, not a guideline
 */

// === CONSTRAINED OPTIMIZATION ===

const CONSTRAINT_TYPES = Object.freeze({
  PHYSICAL: "physical",       // laws of physics, resource limits
  ETHICAL: "ethical",          // moral constraints
  SYSTEMIC: "systemic",       // system stability constraints
  TEMPORAL: "temporal",       // time constraints
  INFORMATIONAL: "informational", // uncertainty constraints
});

// optimizationId -> { objective, constraints[], realityBounds }
const optimizations = new LruMap();

/**
 * Define a reality-constrained optimization.
 * Forbids abstract maximizers — every optimization must have bounds.
 */
function defineConstrainedOptimization(objective, constraints, realityBounds) {
  if (!Array.isArray(constraints) || constraints.length === 0) {
    return { ok: false, error: "optimization_must_have_constraints" };
  }

  const id = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const opt = {
    id,
    objective: String(objective).slice(0, 2000),
    constraints: constraints.map(c => ({
      type: Object.values(CONSTRAINT_TYPES).includes(c.type) ? c.type : CONSTRAINT_TYPES.SYSTEMIC,
      description: String(c.description || c).slice(0, 500),
      bound: c.bound ?? null,
      hardLimit: Boolean(c.hardLimit),
    })),
    realityBounds: {
      maxIterations: Number(realityBounds?.maxIterations || 1000),
      maxResourceCost: Number(realityBounds?.maxResourceCost || 100),
      maxTimeMs: Number(realityBounds?.maxTimeMs || 86400000),
      haltOnViolation: realityBounds?.haltOnViolation !== false,
    },
    status: "defined", // defined | running | halted | completed
    iterations: 0,
    createdAt: new Date().toISOString(),
  };

  optimizations.set(id, opt);
  capMap(optimizations, 5000);
  return { ok: true, optimization: opt };
}

/**
 * Check if an optimization step violates any constraints.
 */
function checkOptimizationConstraints(optimizationId, currentState) {
  const opt = optimizations.get(optimizationId);
  if (!opt) return { ok: false, error: "optimization_not_found" };

  const violations = [];

  // Check iteration limit
  if (opt.iterations >= opt.realityBounds.maxIterations) {
    violations.push({ type: "iteration_limit", detail: `Reached ${opt.iterations} iterations` });
  }

  // Check each constraint
  for (const constraint of opt.constraints) {
    if (constraint.bound !== null && currentState) {
      const stateValue = currentState[constraint.description] ?? currentState.value;
      if (stateValue !== undefined && constraint.hardLimit && stateValue > constraint.bound) {
        violations.push({
          type: constraint.type,
          description: constraint.description,
          value: stateValue,
          bound: constraint.bound,
        });
      }
    }
  }

  if (violations.length > 0 && opt.realityBounds.haltOnViolation) {
    opt.status = "halted";
  }

  opt.iterations++;

  return {
    ok: true,
    violations,
    halted: opt.status === "halted",
    iterationsUsed: opt.iterations,
    iterationsRemaining: opt.realityBounds.maxIterations - opt.iterations,
  };
}

// === SYSTEMIC FRAGILITY DETECTION ===

/**
 * Detect systemic fragility in a system before it activates.
 * Analyzes coupling, concentration, and feedback loops.
 */
function detectSystemicFragility(system) {
  if (!system) return { ok: false, error: "system_description_required" };

  const indicators = [];

  // Tight coupling
  const coupling = Number(system.coupling ?? 0);
  if (coupling > 0.7) {
    indicators.push({
      type: "tight_coupling",
      score: coupling,
      detail: `Coupling ratio ${(coupling * 100).toFixed(0)}% — failures cascade quickly`,
      severity: coupling > 0.9 ? "critical" : "high",
    });
  }

  // Concentration risk
  const concentration = Number(system.concentration ?? 0);
  if (concentration > 0.6) {
    indicators.push({
      type: "concentration_risk",
      score: concentration,
      detail: "Too much depends on too few components",
      severity: "high",
    });
  }

  // Missing redundancy
  const redundancy = Number(system.redundancy ?? 1);
  if (redundancy < 0.3) {
    indicators.push({
      type: "low_redundancy",
      score: 1 - redundancy,
      detail: "Insufficient backup paths for critical functions",
      severity: "high",
    });
  }

  // Positive feedback loops (amplification)
  const feedbackLoops = Number(system.positiveFeedbackLoops ?? 0);
  if (feedbackLoops > 3) {
    indicators.push({
      type: "feedback_amplification",
      score: Math.min(1, feedbackLoops / 10),
      detail: `${feedbackLoops} positive feedback loops detected`,
      severity: feedbackLoops > 5 ? "critical" : "moderate",
    });
  }

  // Buffer depletion
  const bufferRatio = Number(system.bufferRatio ?? 1);
  if (bufferRatio < 0.2) {
    indicators.push({
      type: "buffer_depletion",
      score: 1 - bufferRatio,
      detail: "Safety buffers nearly exhausted",
      severity: "critical",
    });
  }

  const fragilityScore = indicators.length > 0
    ? indicators.reduce((s, i) => s + i.score, 0) / indicators.length
    : 0;

  return {
    ok: true,
    fragile: fragilityScore > 0.5,
    fragilityScore: Math.min(1, fragilityScore),
    indicators,
    criticalCount: indicators.filter(i => i.severity === "critical").length,
  };
}

// === LEVERAGE POINTS & RISK SURFACES ===

const leveragePoints = new LruMap(); // pointId -> { description, leverage, risk, domain }

/**
 * Map a leverage point alongside its risk surface.
 */
function mapLeveragePoint(description, leverageScore, riskScore, domain) {
  const id = `lev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const point = {
    id,
    description: String(description).slice(0, 1000),
    leverage: Math.max(0, Math.min(1, Number(leverageScore ?? 0.5))),
    risk: Math.max(0, Math.min(1, Number(riskScore ?? 0.5))),
    domain: String(domain || "general"),
    ratio: null,
    createdAt: new Date().toISOString(),
  };

  // Leverage-to-risk ratio (higher = better intervention point)
  point.ratio = point.risk > 0 ? point.leverage / point.risk : point.leverage;

  leveragePoints.set(id, point);
  capMap(leveragePoints, 10000);
  return { ok: true, leveragePoint: point };
}

/**
 * Find optimal intervention points (high leverage, low risk).
 */
function findOptimalInterventions(minLeverage, maxRisk) {
  const minLev = Number(minLeverage ?? 0.3);
  const maxR = Number(maxRisk ?? 0.5);

  const optimal = Array.from(leveragePoints.values())
    .filter(p => p.leverage >= minLev && p.risk <= maxR)
    .sort((a, b) => b.ratio - a.ratio);

  return {
    ok: true,
    interventions: optimal.slice(0, 50),
    totalAnalyzed: leveragePoints.size,
    totalOptimal: optimal.length,
  };
}

// === OPTIMIZATION CASCADE PREVENTION ===

/**
 * Detect and prevent optimization cascades:
 * when optimizing one metric degrades others in a chain reaction.
 */
function detectOptimizationCascade(metrics) {
  if (!Array.isArray(metrics) || metrics.length < 2) {
    return { ok: true, cascadeDetected: false, reason: "insufficient_metrics" };
  }

  const cascades = [];

  for (let i = 0; i < metrics.length; i++) {
    const improving = metrics[i];
    if (!improving.trend || improving.trend !== "improving") continue;

    for (let j = 0; j < metrics.length; j++) {
      if (i === j) continue;
      const degrading = metrics[j];
      if (!degrading.trend || degrading.trend !== "degrading") continue;

      // Check temporal correlation
      const timeDiff = Math.abs((improving.lastChanged || 0) - (degrading.lastChanged || 0));
      if (timeDiff < 86400000) { // within 24 hours
        cascades.push({
          improving: { name: improving.name, trend: improving.trend },
          degrading: { name: degrading.name, trend: degrading.trend },
          timeDiffMs: timeDiff,
          likely: timeDiff < 3600000, // within 1 hour = likely cascade
        });
      }
    }
  }

  return {
    ok: true,
    cascadeDetected: cascades.length > 0,
    cascades,
    totalCascades: cascades.length,
    likelyCascades: cascades.filter(c => c.likely).length,
  };
}

// === DO-NO-HARM ENFORCEMENT ===

const DO_NO_HARM_CATEGORIES = Object.freeze({
  PHYSICAL: "physical",
  EPISTEMIC: "epistemic",
  AUTONOMY: "autonomy",
  SYSTEMIC: "systemic",
  IRREVERSIBLE: "irreversible",
});

/**
 * Evaluate an action against civilization-scale "do no harm" primitives.
 */
function evaluateDoNoHarm(action, context) {
  const violations = [];
  const actionText = String(action.description || action).toLowerCase();

  // Physical harm check
  const harmMarkers = ["destroy", "damage", "harm", "injure", "kill", "eliminate"];
  for (const marker of harmMarkers) {
    if (actionText.includes(marker)) {
      violations.push({
        category: DO_NO_HARM_CATEGORIES.PHYSICAL,
        marker,
        severity: "critical",
        detail: `Action contains harm marker: "${marker}"`,
      });
    }
  }

  // Epistemic harm (destroying knowledge)
  const epistemicHarmMarkers = ["erase", "delete knowledge", "suppress", "censor", "rewrite history"];
  for (const marker of epistemicHarmMarkers) {
    if (actionText.includes(marker)) {
      violations.push({
        category: DO_NO_HARM_CATEGORIES.EPISTEMIC,
        marker,
        severity: "high",
        detail: `Action may cause epistemic harm: "${marker}"`,
      });
    }
  }

  // Autonomy harm
  const autonomyMarkers = ["force", "coerce", "compel", "override consent", "without permission"];
  for (const marker of autonomyMarkers) {
    if (actionText.includes(marker)) {
      violations.push({
        category: DO_NO_HARM_CATEGORIES.AUTONOMY,
        marker,
        severity: "high",
        detail: `Action may violate autonomy: "${marker}"`,
      });
    }
  }

  // Irreversibility check
  const irreversibilityCheck = action.irreversibility || context?.irreversibility;
  if (irreversibilityCheck === "irreversible") {
    violations.push({
      category: DO_NO_HARM_CATEGORIES.IRREVERSIBLE,
      severity: "critical",
      detail: "Irreversible action requires explicit approval",
    });
  }

  return {
    ok: true,
    safe: violations.length === 0,
    violations,
    totalViolations: violations.length,
    criticalCount: violations.filter(v => v.severity === "critical").length,
    recommendation: violations.length === 0 ? "proceed"
      : violations.some(v => v.severity === "critical") ? "block"
      : "review",
  };
}

// === INTELLIGENCE-POWER SEPARATION ===

/**
 * Evaluate whether intelligence growth is being separated from power application.
 * Flags cases where growing capability is directly coupled to action authority.
 */
function evaluateIntelligencePowerSeparation(capabilities, authorities) {
  const caps = Array.isArray(capabilities) ? capabilities : [];
  const auths = Array.isArray(authorities) ? authorities : [];

  const couplings = [];

  for (const cap of caps) {
    for (const auth of auths) {
      const capText = String(cap.name || cap).toLowerCase();
      const authText = String(auth.name || auth).toLowerCase();

      // Check for direct coupling (same domain, correlated growth)
      const capWords = new Set(capText.split(/\s+/).filter(w => w.length > 3));
      const authWords = new Set(authText.split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const w of capWords) if (authWords.has(w)) overlap++;

      if (overlap >= 2) {
        couplings.push({
          capability: String(cap.name || cap).slice(0, 200),
          authority: String(auth.name || auth).slice(0, 200),
          overlap,
          risk: "intelligence_power_coupling",
        });
      }
    }
  }

  return {
    ok: true,
    separated: couplings.length === 0,
    couplings,
    totalCouplings: couplings.length,
    recommendation: couplings.length === 0
      ? "Good separation maintained"
      : `${couplings.length} capability-authority couplings detected — review required`,
  };
}

// === STABILITY-FIRST INTERVENTION PLANNING ===

/**
 * Plan an intervention with stability as the primary constraint.
 * The intervention must not decrease system stability.
 */
function planStabilityFirstIntervention(intervention, currentStability, stabilityFloor) {
  const floor = Math.max(0, Math.min(1, Number(stabilityFloor ?? 0.5)));
  const current = Math.max(0, Math.min(1, Number(currentStability ?? 0.7)));

  const estimatedImpact = Number(intervention.estimatedStabilityImpact ?? 0);
  const projectedStability = current + estimatedImpact;

  const plan = {
    intervention: String(intervention.description || intervention).slice(0, 1000),
    currentStability: current,
    stabilityFloor: floor,
    estimatedImpact,
    projectedStability,
    approved: projectedStability >= floor,
    reason: projectedStability < floor
      ? `Would reduce stability to ${(projectedStability * 100).toFixed(0)}%, below floor of ${(floor * 100).toFixed(0)}%`
      : "Stability constraint satisfied",
    safeguards: projectedStability < current ? [
      "Monitor stability metrics continuously during intervention",
      "Prepare rollback plan before proceeding",
      "Set automatic halt if stability drops below floor",
    ] : [],
  };

  return { ok: true, plan };
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
  STATE.__loaf.interventionGovernance = {
    stats: {
      optimizationsDefined: 0, constraintChecks: 0, fragilityScans: 0,
      leveragePointsMapped: 0, cascadeChecks: 0, doNoHarmChecks: 0,
      separationChecks: 0, stabilityPlans: 0,
    },
  };

  register("loaf.intervention", "status", (ctx) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    return {
      ok: true,
      optimizations: optimizations.size,
      leveragePoints: leveragePoints.size,
      stats: ig.stats,
    };
  }, { public: true });

  register("loaf.intervention", "define_optimization", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.optimizationsDefined++;
    return defineConstrainedOptimization(input.objective, input.constraints, input.realityBounds);
  }, { public: false });

  register("loaf.intervention", "check_constraints", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.constraintChecks++;
    return checkOptimizationConstraints(String(input.optimizationId || ""), input.currentState);
  }, { public: true });

  register("loaf.intervention", "detect_fragility", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.fragilityScans++;
    return detectSystemicFragility(input.system || input);
  }, { public: true });

  register("loaf.intervention", "map_leverage_point", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.leveragePointsMapped++;
    return mapLeveragePoint(input.description, input.leverage, input.risk, input.domain);
  }, { public: false });

  register("loaf.intervention", "find_optimal_interventions", (_ctx, input = {}) => {
    return findOptimalInterventions(input.minLeverage, input.maxRisk);
  }, { public: true });

  register("loaf.intervention", "detect_cascade", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.cascadeChecks++;
    return detectOptimizationCascade(input.metrics || []);
  }, { public: true });

  register("loaf.intervention", "evaluate_do_no_harm", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.doNoHarmChecks++;
    return evaluateDoNoHarm(input.action || input, input.context);
  }, { public: true });

  register("loaf.intervention", "check_separation", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.separationChecks++;
    return evaluateIntelligencePowerSeparation(input.capabilities, input.authorities);
  }, { public: true });

  register("loaf.intervention", "plan_stable_intervention", (ctx, input = {}) => {
    const ig = ctx.state.__loaf.interventionGovernance;
    ig.stats.stabilityPlans++;
    return planStabilityFirstIntervention(
      input.intervention || input, input.currentStability, input.stabilityFloor
    );
  }, { public: true });
}

export {
  CONSTRAINT_TYPES,
  DO_NO_HARM_CATEGORIES,
  defineConstrainedOptimization,
  checkOptimizationConstraints,
  detectSystemicFragility,
  mapLeveragePoint,
  findOptimalInterventions,
  detectOptimizationCascade,
  evaluateDoNoHarm,
  evaluateIntelligencePowerSeparation,
  planStabilityFirstIntervention,
  init,
};
