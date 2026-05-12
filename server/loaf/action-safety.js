import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VII.2 — Action Safety & Irreversibility Management
 *
 * Capabilities (Reality-Grounded Epistemics):
 *   8.  Action-safety envelopes (what actions are safe given uncertainty)
 *   9.  Counterfactual grounding with rollback guarantees
 *   12. Formal representation of irreversibility
 *   13. Long-term consequence tracing across decisions
 *   14. Identification of points of no return
 *   15. Controlled experimentation frameworks
 *   16. Safe exploration under bounded harm
 *   20. Action throttling under epistemic instability
 *   21. Governance of when not to act
 *   22. Alignment between epistemic confidence and operational authority
 *   23. Decision abstention enforcement
 *   24. Auditability of decisions, not just beliefs
 *
 * Design:
 *   - Actions carry safety envelopes defining bounds under uncertainty
 *   - Irreversibility is formally typed and tracked
 *   - Consequence traces follow decision trees across time
 *   - Points of no return are identified before they are reached
 *   - Exploration is bounded by explicit harm budgets
 *   - Decision abstention is enforced when confidence is insufficient
 */

// === ACTION SAFETY ENVELOPES ===

const SAFETY_LEVELS = Object.freeze({
  SAFE: "safe",               // well within safe bounds
  CAUTION: "caution",         // approaching limits
  BOUNDARY: "boundary",       // at the edge of safety
  UNSAFE: "unsafe",           // beyond safe envelope
});

// actionId -> { envelope, confidence, constraints }
const actionEnvelopes = new LruMap();

/**
 * Define a safety envelope for an action.
 */
function defineEnvelope(actionName, constraints, confidenceRequired) {
  const id = `env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const envelope = {
    id,
    actionName: String(actionName).slice(0, 200),
    constraints: Array.isArray(constraints) ? constraints.map(c => ({
      parameter: String(c.parameter || c.name || "").slice(0, 100),
      min: c.min ?? null,
      max: c.max ?? null,
      description: String(c.description || "").slice(0, 500),
    })) : [],
    confidenceRequired: Math.max(0, Math.min(1, Number(confidenceRequired ?? 0.7))),
    createdAt: new Date().toISOString(),
  };

  actionEnvelopes.set(id, envelope);
  capMap(actionEnvelopes, 10000);
  return { ok: true, envelope };
}

/**
 * Check if a proposed action is within its safety envelope.
 */
function checkEnvelope(envelopeId, proposedValues, currentConfidence) {
  const envelope = actionEnvelopes.get(envelopeId);
  if (!envelope) return { ok: false, error: "envelope_not_found" };

  const violations = [];
  const proposed = proposedValues || {};

  for (const constraint of envelope.constraints) {
    const value = proposed[constraint.parameter];
    if (value === undefined) continue;

    if (constraint.min !== null && value < constraint.min) {
      violations.push({
        parameter: constraint.parameter,
        value,
        limit: constraint.min,
        type: "below_minimum",
      });
    }
    if (constraint.max !== null && value > constraint.max) {
      violations.push({
        parameter: constraint.parameter,
        value,
        limit: constraint.max,
        type: "above_maximum",
      });
    }
  }

  const conf = Math.max(0, Math.min(1, Number(currentConfidence ?? 0)));
  const confidenceMet = conf >= envelope.confidenceRequired;

  let level;
  if (violations.length > 0) level = SAFETY_LEVELS.UNSAFE;
  else if (!confidenceMet) level = SAFETY_LEVELS.CAUTION;
  else level = SAFETY_LEVELS.SAFE;

  return {
    ok: true,
    level,
    safe: level === SAFETY_LEVELS.SAFE,
    violations,
    confidenceRequired: envelope.confidenceRequired,
    currentConfidence: conf,
    confidenceMet,
  };
}

// === IRREVERSIBILITY TRACKING ===

const IRREVERSIBILITY_TYPES = Object.freeze({
  FULLY_REVERSIBLE: "fully_reversible",
  PARTIALLY_REVERSIBLE: "partially_reversible",
  IRREVERSIBLE: "irreversible",
  UNKNOWN: "unknown",
});

// decisionId -> { type, description, irreversibility, consequences }
const decisions = new LruMap();

/**
 * Register a decision with its irreversibility classification.
 */
function registerDecision(description, irreversibility, domain, actor) {
  const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const decision = {
    id,
    description: String(description).slice(0, 2000),
    irreversibility: Object.values(IRREVERSIBILITY_TYPES).includes(irreversibility)
      ? irreversibility
      : IRREVERSIBILITY_TYPES.UNKNOWN,
    domain: String(domain || "general"),
    actor: String(actor || "system"),
    consequences: [],
    pointOfNoReturn: null,
    auditTrail: [{
      action: "registered",
      ts: new Date().toISOString(),
      actor: String(actor || "system"),
    }],
    createdAt: new Date().toISOString(),
  };

  decisions.set(id, decision);
  capMap(decisions, 50000);
  return { ok: true, decision: sanitizeDecision(decision) };
}

/**
 * Add an audit entry to a decision.
 */
function auditDecision(decisionId, action, details, actor) {
  const dec = decisions.get(decisionId);
  if (!dec) return { ok: false, error: "decision_not_found" };

  dec.auditTrail.push({
    action: String(action).slice(0, 200),
    details: String(details || "").slice(0, 1000),
    actor: String(actor || "system"),
    ts: new Date().toISOString(),
  });
  if (dec.auditTrail.length > 200) dec.auditTrail.splice(0, dec.auditTrail.length - 200);

  return { ok: true, auditCount: dec.auditTrail.length };
}

// === CONSEQUENCE TRACING ===

/**
 * Trace long-term consequences of a decision across time.
 */
function traceConsequences(decisionId, consequence) {
  const dec = decisions.get(decisionId);
  if (!dec) return { ok: false, error: "decision_not_found" };

  const entry = {
    id: `csq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    description: String(consequence.description || consequence).slice(0, 1000),
    severity: consequence.severity || "moderate",
    timeHorizon: String(consequence.timeHorizon || "unknown"),
    observed: Boolean(consequence.observed),
    tracedAt: new Date().toISOString(),
  };

  dec.consequences.push(entry);
  if (dec.consequences.length > 200) dec.consequences.splice(0, dec.consequences.length - 200);

  return { ok: true, consequence: entry };
}

/**
 * Identify points of no return across registered decisions.
 */
function identifyPointsOfNoReturn() {
  const ponrs = [];

  for (const [, dec] of decisions) {
    if (dec.irreversibility === IRREVERSIBILITY_TYPES.IRREVERSIBLE) {
      const severeConsequences = dec.consequences.filter(
        c => c.severity === "critical" || c.severity === "high"
      );
      if (severeConsequences.length > 0 || dec.consequences.length === 0) {
        ponrs.push({
          decisionId: dec.id,
          description: dec.description.slice(0, 200),
          domain: dec.domain,
          consequenceCount: dec.consequences.length,
          severeConsequences: severeConsequences.length,
          createdAt: dec.createdAt,
        });
      }
    }
  }

  return {
    ok: true,
    pointsOfNoReturn: ponrs,
    total: ponrs.length,
  };
}

// === CONTROLLED EXPERIMENTATION ===

const experiments = new LruMap(); // experimentId -> Experiment

/**
 * Create a controlled experiment with bounded harm budget.
 */
function createExperiment(hypothesis, harmBudget, controls) {
  const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const experiment = {
    id,
    hypothesis: String(hypothesis).slice(0, 2000),
    harmBudget: {
      maxHarm: Math.max(0, Number(harmBudget?.maxHarm ?? 10)),
      currentHarm: 0,
      unit: String(harmBudget?.unit || "abstract"),
    },
    controls: Array.isArray(controls) ? controls.map(c => ({
      parameter: String(c.parameter || c).slice(0, 200),
      value: c.value ?? null,
    })) : [],
    observations: [],
    status: "active", // active | halted | completed
    haltReason: null,
    createdAt: new Date().toISOString(),
  };

  experiments.set(id, experiment);
  capMap(experiments, 5000);
  return { ok: true, experiment: sanitizeExperiment(experiment) };
}

/**
 * Record an observation in an experiment, checking harm budget.
 */
function recordExperimentObservation(experimentId, observation, harmCost) {
  const exp = experiments.get(experimentId);
  if (!exp) return { ok: false, error: "experiment_not_found" };
  if (exp.status !== "active") return { ok: false, error: "experiment_not_active" };

  const cost = Math.max(0, Number(harmCost || 0));

  // Check harm budget before recording
  if (exp.harmBudget.currentHarm + cost > exp.harmBudget.maxHarm) {
    exp.status = "halted";
    exp.haltReason = "harm_budget_exceeded";
    return {
      ok: false,
      error: "harm_budget_would_be_exceeded",
      currentHarm: exp.harmBudget.currentHarm,
      maxHarm: exp.harmBudget.maxHarm,
      requestedCost: cost,
    };
  }

  exp.harmBudget.currentHarm += cost;

  exp.observations.push({
    description: String(observation).slice(0, 1000),
    harmCost: cost,
    recordedAt: new Date().toISOString(),
  });
  if (exp.observations.length > 500) exp.observations.splice(0, exp.observations.length - 500);

  return {
    ok: true,
    remainingBudget: exp.harmBudget.maxHarm - exp.harmBudget.currentHarm,
  };
}

// === ACTION THROTTLING ===

// throttleId -> { domain, rate, window, actions[] }
const throttles = new LruMap();

/**
 * Define an action throttle for a domain under epistemic instability.
 */
function defineThrottle(domain, maxActionsPerWindow, windowMs) {
  const id = `thr_${String(domain).toLowerCase().replace(/\s+/g, "_")}`;

  throttles.set(id, {
    id,
    domain: String(domain),
    maxActions: Number(maxActionsPerWindow || 10),
    windowMs: Number(windowMs || 3600000), // default 1 hour
    actions: [],
    createdAt: new Date().toISOString(),
  });

  capMap(throttles, 1000);
  return { ok: true, throttle: throttles.get(id) };
}

/**
 * Check if an action is allowed under the current throttle.
 */
function checkThrottle(domain) {
  const id = `thr_${String(domain).toLowerCase().replace(/\s+/g, "_")}`;
  const throttle = throttles.get(id);
  if (!throttle) return { ok: true, allowed: true, reason: "no_throttle_defined" };

  const now = Date.now();
  // Clean old actions
  throttle.actions = throttle.actions.filter(ts => now - ts < throttle.windowMs);

  if (throttle.actions.length >= throttle.maxActions) {
    return {
      ok: true,
      allowed: false,
      reason: "throttle_exceeded",
      currentActions: throttle.actions.length,
      maxActions: throttle.maxActions,
      windowMs: throttle.windowMs,
      retryAfterMs: throttle.actions[0] + throttle.windowMs - now,
    };
  }

  throttle.actions.push(now);
  return { ok: true, allowed: true, remaining: throttle.maxActions - throttle.actions.length };
}

// === DECISION ABSTENTION ===

const abstentionRules = new LruMap(); // ruleId -> { domain, minConfidence, ... }

/**
 * Define a decision abstention rule: the system MUST NOT act
 * below a confidence threshold.
 */
function defineAbstentionRule(domain, minConfidence, description) {
  const id = `abr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rule = {
    id,
    domain: String(domain),
    minConfidence: Math.max(0, Math.min(1, Number(minConfidence ?? 0.7))),
    description: String(description || "").slice(0, 1000),
    enforcements: 0,
    createdAt: new Date().toISOString(),
  };

  abstentionRules.set(id, rule);
  capMap(abstentionRules, 5000);
  return { ok: true, rule };
}

/**
 * Check if a decision must be abstained from based on confidence.
 */
function enforceAbstention(domain, currentConfidence) {
  const applicableRules = Array.from(abstentionRules.values())
    .filter(r => r.domain === domain || r.domain === "*");

  for (const rule of applicableRules) {
    const conf = Math.max(0, Math.min(1, Number(currentConfidence ?? 0)));
    if (conf < rule.minConfidence) {
      rule.enforcements++;
      return {
        ok: true,
        mustAbstain: true,
        reason: `Confidence ${(conf * 100).toFixed(0)}% below threshold ${(rule.minConfidence * 100).toFixed(0)}%`,
        ruleId: rule.id,
        domain,
      };
    }
  }

  return { ok: true, mustAbstain: false, domain };
}

// === HELPERS ===

function sanitizeDecision(dec) {
  return {
    id: dec.id,
    description: dec.description.slice(0, 200),
    irreversibility: dec.irreversibility,
    domain: dec.domain,
    consequenceCount: dec.consequences.length,
    auditCount: dec.auditTrail.length,
    createdAt: dec.createdAt,
  };
}

function sanitizeExperiment(exp) {
  return {
    id: exp.id,
    hypothesis: exp.hypothesis.slice(0, 200),
    status: exp.status,
    harmUsed: exp.harmBudget.currentHarm,
    harmMax: exp.harmBudget.maxHarm,
    observations: exp.observations.length,
  };
}

function capMap(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.actionSafety = {
    stats: {
      envelopesDefined: 0, envelopeChecks: 0, decisionsRegistered: 0,
      consequencesTraced: 0, experimentsCreated: 0, throttleChecks: 0,
      abstentionEnforcements: 0, audits: 0,
    },
  };

  register("loaf.action_safety", "status", (ctx) => {
    const as = ctx.state.__loaf.actionSafety;
    return {
      ok: true,
      envelopes: actionEnvelopes.size,
      decisions: decisions.size,
      experiments: experiments.size,
      throttles: throttles.size,
      abstentionRules: abstentionRules.size,
      stats: as.stats,
    };
  }, { public: true });

  register("loaf.action_safety", "define_envelope", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.envelopesDefined++;
    return defineEnvelope(input.actionName, input.constraints, input.confidenceRequired);
  }, { public: false });

  register("loaf.action_safety", "check_envelope", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.envelopeChecks++;
    return checkEnvelope(String(input.envelopeId || ""), input.values, input.confidence);
  }, { public: true });

  register("loaf.action_safety", "register_decision", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.decisionsRegistered++;
    return registerDecision(input.description, input.irreversibility, input.domain, ctx.actor?.id);
  }, { public: false });

  register("loaf.action_safety", "audit_decision", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.audits++;
    return auditDecision(String(input.decisionId || ""), input.action, input.details, ctx.actor?.id);
  }, { public: false });

  register("loaf.action_safety", "trace_consequence", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.consequencesTraced++;
    return traceConsequences(String(input.decisionId || ""), input.consequence || input);
  }, { public: false });

  register("loaf.action_safety", "points_of_no_return", (_ctx) => {
    return identifyPointsOfNoReturn();
  }, { public: true });

  register("loaf.action_safety", "create_experiment", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.experimentsCreated++;
    return createExperiment(input.hypothesis, input.harmBudget, input.controls);
  }, { public: false });

  register("loaf.action_safety", "record_observation", (_ctx, input = {}) => {
    return recordExperimentObservation(String(input.experimentId || ""), input.observation, input.harmCost);
  }, { public: false });

  register("loaf.action_safety", "define_throttle", (_ctx, input = {}) => {
    return defineThrottle(input.domain, input.maxActions, input.windowMs);
  }, { public: false });

  register("loaf.action_safety", "check_throttle", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.throttleChecks++;
    return checkThrottle(String(input.domain || ""));
  }, { public: true });

  register("loaf.action_safety", "define_abstention_rule", (_ctx, input = {}) => {
    return defineAbstentionRule(input.domain, input.minConfidence, input.description);
  }, { public: false });

  register("loaf.action_safety", "enforce_abstention", (ctx, input = {}) => {
    const as = ctx.state.__loaf.actionSafety;
    as.stats.abstentionEnforcements++;
    return enforceAbstention(String(input.domain || ""), input.confidence);
  }, { public: true });

  register("loaf.action_safety", "list_decisions", (_ctx, input = {}) => {
    let list = Array.from(decisions.values());
    if (input.domain) list = list.filter(d => d.domain === input.domain);
    if (input.irreversibility) list = list.filter(d => d.irreversibility === input.irreversibility);
    return { ok: true, decisions: list.slice(-(Number(input.limit || 50))).map(sanitizeDecision) };
  }, { public: true });
}

export {
  SAFETY_LEVELS,
  IRREVERSIBILITY_TYPES,
  defineEnvelope,
  checkEnvelope,
  registerDecision,
  auditDecision,
  traceConsequences,
  identifyPointsOfNoReturn,
  createExperiment,
  recordExperimentObservation,
  defineThrottle,
  checkThrottle,
  defineAbstentionRule,
  enforceAbstention,
  init,
};
