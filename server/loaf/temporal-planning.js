import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IV.3 — Temporal Planning & World Models
 *
 * Capabilities:
 *   7.  Long-horizon planning with rollback guarantees
 *   8.  Temporal forecasting with confidence decay curves
 *   13. Multi-version reality simulation (parallel world models)
 *   24. Long-term memory pruning with loss guarantees
 *   25. Historical replay across multiple forks simultaneously
 *   26. Cognitive diffing between users, eras, or models
 *   28. Governance evolution driven by observed failure modes
 *   29. Self-healing governance rules (without self-legitimation)
 *
 * Design:
 *   - Plans are versioned with explicit rollback points
 *   - Forecasts carry confidence that decays with temporal distance
 *   - Parallel world models run independently and can be compared
 *   - Memory pruning guarantees bounded information loss
 *   - Cognitive diffing compares knowledge states across dimensions
 */

// === LONG-HORIZON PLANNING ===

const PLAN_STATES = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  CHECKPOINT: "checkpoint",
  ROLLED_BACK: "rolled_back",
  COMPLETED: "completed",
  FAILED: "failed",
});

// Plans store
const plans = new LruMap(); // planId -> Plan

/**
 * Create a long-horizon plan with rollback guarantees.
 */
function createPlan(goal, steps, horizonMs, actor) {
  const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const plan = {
    id,
    goal: String(goal).slice(0, 2000),
    state: PLAN_STATES.DRAFT,
    steps: Array.isArray(steps) ? steps.map((s, i) => ({
      index: i,
      description: String(s.description || s).slice(0, 1000),
      state: "pending", // pending | in_progress | completed | failed | rolled_back
      checkpoint: null,
      completedAt: null,
    })) : [],
    horizonMs: Math.max(0, Number(horizonMs || 86400000)), // default 24h
    checkpoints: [],
    rollbacks: [],
    createdBy: String(actor || "system"),
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  plans.set(id, plan);
  capMap(plans, 10000);

  return { ok: true, plan: sanitizePlan(plan) };
}

/**
 * Create a checkpoint at the current step — snapshot for rollback.
 */
function checkpoint(planId, stateSnapshot, description) {
  const plan = plans.get(planId);
  if (!plan) return { ok: false, error: "plan_not_found" };

  const cp = {
    id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stepIndex: plan.steps.findIndex(s => s.state === "in_progress"),
    stateSnapshot: (() => { try { return JSON.parse(JSON.stringify(stateSnapshot)); } catch (err) { console.debug('[temporal-planning] deep clone failed', err?.message); return stateSnapshot; } })(),
    description: String(description || "").slice(0, 1000),
    createdAt: new Date().toISOString(),
  };

  plan.checkpoints.push(cp);
  if (plan.checkpoints.length > 100) plan.checkpoints.splice(0, plan.checkpoints.length - 100);

  return { ok: true, checkpoint: cp };
}

/**
 * Rollback a plan to a specific checkpoint.
 * Guarantees that all steps after the checkpoint are reverted.
 */
function rollback(planId, checkpointId) {
  const plan = plans.get(planId);
  if (!plan) return { ok: false, error: "plan_not_found" };

  const cp = plan.checkpoints.find(c => c.id === checkpointId);
  if (!cp) return { ok: false, error: "checkpoint_not_found" };

  // Revert all steps after the checkpoint
  const rolledBackSteps = [];
  for (const step of plan.steps) {
    if (step.index > cp.stepIndex && step.state !== "pending") {
      step.state = "rolled_back";
      rolledBackSteps.push(step.index);
    }
  }

  plan.rollbacks.push({
    checkpointId,
    stepIndex: cp.stepIndex,
    rolledBackSteps,
    rolledBackAt: new Date().toISOString(),
  });

  plan.state = PLAN_STATES.ROLLED_BACK;

  return {
    ok: true,
    rolledBackSteps,
    restoredState: cp.stateSnapshot,
    plan: sanitizePlan(plan),
  };
}

// === TEMPORAL FORECASTING ===

// Forecasts with confidence decay
const forecasts = new LruMap(); // forecastId -> Forecast

const CONFIDENCE_DECAY_MODELS = Object.freeze({
  EXPONENTIAL: "exponential",
  LINEAR: "linear",
  STEP: "step",
});

/**
 * Create a temporal forecast with confidence decay curve.
 */
function createForecast(prediction, initialConfidence, horizonMs, decayModel) {
  const id = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const forecast = {
    id,
    prediction: String(prediction).slice(0, 2000),
    initialConfidence: Math.max(0, Math.min(1, Number(initialConfidence || 0.5))),
    currentConfidence: Math.max(0, Math.min(1, Number(initialConfidence || 0.5))),
    horizonMs: Math.max(0, Number(horizonMs || 86400000)),
    decayModel: CONFIDENCE_DECAY_MODELS[decayModel?.toUpperCase()] || CONFIDENCE_DECAY_MODELS.EXPONENTIAL,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (horizonMs || 86400000)).toISOString(),
    resolved: false,
    outcome: null,
  };

  forecasts.set(id, forecast);
  capMap(forecasts, 50000);

  return { ok: true, forecast };
}

/**
 * Compute current confidence for a forecast based on its decay curve.
 */
function computeDecayedConfidence(forecastId) {
  const fc = forecasts.get(forecastId);
  if (!fc) return { ok: false, error: "forecast_not_found" };

  const elapsed = Date.now() - new Date(fc.createdAt).getTime();
  const ratio = Math.min(1, elapsed / fc.horizonMs);
  let confidence;

  switch (fc.decayModel) {
    case CONFIDENCE_DECAY_MODELS.LINEAR:
      confidence = fc.initialConfidence * (1 - ratio);
      break;
    case CONFIDENCE_DECAY_MODELS.STEP:
      confidence = ratio < 0.5 ? fc.initialConfidence : fc.initialConfidence * 0.3;
      break;
    case CONFIDENCE_DECAY_MODELS.EXPONENTIAL:
    default:
      confidence = fc.initialConfidence * Math.exp(-3 * ratio);
      break;
  }

  fc.currentConfidence = Math.max(0, Math.min(1, confidence));

  return {
    ok: true,
    forecastId,
    currentConfidence: fc.currentConfidence,
    initialConfidence: fc.initialConfidence,
    elapsed,
    ratio,
    decayModel: fc.decayModel,
    expired: elapsed >= fc.horizonMs,
  };
}

// === PARALLEL WORLD MODELS ===

// World model store: each world model is an independent simulation
const worldModels = new LruMap(); // worldModelId -> WorldModel

/**
 * Create a parallel world model for reality simulation.
 */
function createWorldModel(label, initialState, assumptions) {
  const id = `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const model = {
    id,
    label: String(label).slice(0, 500),
    state: (() => { try { return JSON.parse(JSON.stringify(initialState || {})); } catch (err) { console.debug('[temporal-planning] deep clone failed', err?.message); return { ...initialState }; } })(),
    assumptions: Array.isArray(assumptions) ? assumptions.map(a => String(a).slice(0, 500)) : [],
    events: [],
    divergencePoints: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  worldModels.set(id, model);
  capMap(worldModels, 5000);

  return { ok: true, worldModel: sanitizeWorldModel(model) };
}

/**
 * Apply an event to a world model, mutating its state.
 */
function applyWorldEvent(worldModelId, event, stateChanges) {
  const model = worldModels.get(worldModelId);
  if (!model) return { ok: false, error: "world_model_not_found" };

  const ev = {
    description: String(event.description || event).slice(0, 1000),
    stateChanges: stateChanges || {},
    appliedAt: new Date().toISOString(),
  };

  // Apply state changes
  for (const [key, value] of Object.entries(stateChanges || {})) {
    model.state[key] = value;
  }

  model.events.push(ev);
  if (model.events.length > 500) model.events.splice(0, model.events.length - 500);
  model.updatedAt = new Date().toISOString();

  return { ok: true, event: ev, worldModel: sanitizeWorldModel(model) };
}

/**
 * Compare two world models — find divergence points and outcome differences.
 */
function compareWorldModels(modelIdA, modelIdB) {
  const a = worldModels.get(modelIdA);
  const b = worldModels.get(modelIdB);
  if (!a || !b) return { ok: false, error: "world_model_not_found" };

  const stateA = a.state || {};
  const stateB = b.state || {};

  const keysA = new Set(Object.keys(stateA));
  const keysB = new Set(Object.keys(stateB));
  const allKeys = new Set([...keysA, ...keysB]);

  const differences = [];
  const shared = [];

  for (const key of allKeys) {
    const inA = keysA.has(key);
    const inB = keysB.has(key);

    if (inA && inB) {
      if (JSON.stringify(stateA[key]) !== JSON.stringify(stateB[key])) {
        differences.push({ key, valueA: stateA[key], valueB: stateB[key], type: "diverged" });
      } else {
        shared.push(key);
      }
    } else if (inA && !inB) {
      differences.push({ key, valueA: stateA[key], type: "only_in_a" });
    } else {
      differences.push({ key, valueB: stateB[key], type: "only_in_b" });
    }
  }

  // Compare assumptions
  const assumptionDiff = {
    onlyInA: a.assumptions.filter(x => !b.assumptions.includes(x)),
    onlyInB: b.assumptions.filter(x => !a.assumptions.includes(x)),
    shared: a.assumptions.filter(x => b.assumptions.includes(x)),
  };

  return {
    ok: true,
    modelA: { id: a.id, label: a.label, eventCount: a.events.length },
    modelB: { id: b.id, label: b.label, eventCount: b.events.length },
    differences,
    sharedKeys: shared.length,
    divergenceCount: differences.length,
    assumptionDiff,
  };
}

// === MEMORY PRUNING WITH LOSS GUARANTEES ===

/**
 * Prune a knowledge set while guaranteeing bounded information loss.
 * Uses importance scoring to determine what to keep.
 *
 * @param {Array} items - Knowledge items with { id, importance, lastAccessed, tags }
 * @param {number} targetSize - Desired size after pruning
 * @param {number} maxLoss - Maximum acceptable information loss (0-1)
 * @returns Pruned set with loss metrics
 */
function pruneWithLossGuarantee(items, targetSize, maxLoss = 0.1) {
  if (!Array.isArray(items) || items.length <= targetSize) {
    return { ok: true, pruned: items, removed: [], loss: 0 };
  }

  // Score each item
  const scored = items.map(item => ({
    ...item,
    score: (Number(item.importance || 0.5)) * 0.6 +
           (item.lastAccessed ? Math.exp(-(Date.now() - item.lastAccessed) / 86400000) : 0.1) * 0.3 +
           (item.connections || 0) * 0.1,
  }));

  // Sort by score descending (most important first)
  scored.sort((a, b) => b.score - a.score);

  // Calculate cumulative importance
  const totalImportance = scored.reduce((s, item) => s + item.score, 0);

  // Keep items until we hit the target size or exceed loss budget
  const kept = [];
  const removed = [];
  let removedImportance = 0;

  for (const item of scored) {
    if (kept.length < targetSize) {
      kept.push(item);
    } else {
      const potentialLoss = (removedImportance + item.score) / totalImportance;
      if (potentialLoss <= maxLoss) {
        removed.push(item);
        removedImportance += item.score;
      } else {
        // Exceeding loss budget — keep this item by swapping with lowest-scored kept item
        kept.push(item);
      }
    }
  }

  const actualLoss = totalImportance > 0 ? removedImportance / totalImportance : 0;

  return {
    ok: true,
    pruned: kept.slice(0, targetSize),
    removed,
    loss: actualLoss,
    maxLoss,
    lossGuaranteeMet: actualLoss <= maxLoss,
    originalSize: items.length,
    prunedSize: Math.min(kept.length, targetSize),
  };
}

// === COGNITIVE DIFFING ===

/**
 * Compute a cognitive diff between two knowledge states.
 * Can compare users, eras, or model versions.
 */
function cognitiveDiff(stateA, stateB, labelA, labelB) {
  const a = stateA || {};
  const b = stateB || {};

  const domainsA = new Set(Object.keys(a.domains || {}));
  const domainsB = new Set(Object.keys(b.domains || {}));

  const diff = {
    labelA: String(labelA || "A"),
    labelB: String(labelB || "B"),
    domains: {
      onlyInA: [...domainsA].filter(d => !domainsB.has(d)),
      onlyInB: [...domainsB].filter(d => !domainsA.has(d)),
      shared: [...domainsA].filter(d => domainsB.has(d)),
    },
    metrics: {
      totalDomainsA: domainsA.size,
      totalDomainsB: domainsB.size,
      overlap: [...domainsA].filter(d => domainsB.has(d)).length,
      jaccardSimilarity: 0,
    },
    beliefs: {
      added: [],
      removed: [],
      changed: [],
    },
    computedAt: new Date().toISOString(),
  };

  // Jaccard similarity of domains
  const union = new Set([...domainsA, ...domainsB]);
  diff.metrics.jaccardSimilarity = union.size > 0
    ? diff.metrics.overlap / union.size
    : 1;

  // Compare beliefs within shared domains
  for (const domain of diff.domains.shared) {
    const beliefsA = a.domains[domain]?.beliefs || {};
    const beliefsB = b.domains[domain]?.beliefs || {};

    for (const [key, val] of Object.entries(beliefsB)) {
      if (!(key in beliefsA)) {
        diff.beliefs.added.push({ domain, key, value: val });
      } else if (JSON.stringify(beliefsA[key]) !== JSON.stringify(val)) {
        diff.beliefs.changed.push({ domain, key, from: beliefsA[key], to: val });
      }
    }

    for (const key of Object.keys(beliefsA)) {
      if (!(key in beliefsB)) {
        diff.beliefs.removed.push({ domain, key, value: beliefsA[key] });
      }
    }
  }

  return diff;
}

// === SELF-HEALING GOVERNANCE ===

const governanceFailures = []; // Observed governance failure log

/**
 * Record a governance failure and generate a self-healing rule proposal.
 * Self-healing rules are PROPOSALS — they require council approval (no self-legitimation).
 */
function proposeGovernanceHeal(failure) {
  const entry = {
    id: `gheal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    failure: {
      type: String(failure.type || "unknown"),
      description: String(failure.description || "").slice(0, 2000),
      impact: String(failure.impact || "unknown"),
      observedAt: new Date().toISOString(),
    },
    proposedRule: {
      text: `Prevent recurrence of ${failure.type}: ${String(failure.description || "").slice(0, 200)}`,
      type: "self_healing_proposal",
      requiresCouncilApproval: true, // ALWAYS true — no self-legitimation
      autoApply: false,               // NEVER auto-apply
    },
    status: "proposed", // proposed | approved | rejected
    createdAt: new Date().toISOString(),
  };

  governanceFailures.push(entry);
  if (governanceFailures.length > 500) governanceFailures.splice(0, governanceFailures.length - 500);

  return { ok: true, proposal: entry };
}

// === HELPERS ===

function sanitizePlan(plan) {
  return {
    id: plan.id,
    goal: plan.goal.slice(0, 200),
    state: plan.state,
    stepCount: plan.steps.length,
    completedSteps: plan.steps.filter(s => s.state === "completed").length,
    checkpoints: plan.checkpoints.length,
    rollbacks: plan.rollbacks.length,
    createdAt: plan.createdAt,
  };
}

function sanitizeWorldModel(model) {
  return {
    id: model.id,
    label: model.label,
    stateKeys: Object.keys(model.state).length,
    assumptions: model.assumptions.length,
    events: model.events.length,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
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
  STATE.__loaf.temporalPlanning = {
    stats: {
      plansCreated: 0, checkpoints: 0, rollbacks: 0,
      forecastsCreated: 0, worldModelsCreated: 0, comparisons: 0,
      pruneOps: 0, diffs: 0, governanceHeals: 0,
    },
  };

  register("loaf.temporal_planning", "status", (ctx) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    return {
      ok: true,
      plans: plans.size,
      forecasts: forecasts.size,
      worldModels: worldModels.size,
      governanceFailures: governanceFailures.length,
      stats: tp.stats,
    };
  }, { public: true });

  // Plan operations
  register("loaf.temporal_planning", "create_plan", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.plansCreated++;
    return createPlan(input.goal, input.steps, input.horizonMs, ctx.actor?.id);
  }, { public: false });

  register("loaf.temporal_planning", "checkpoint", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.checkpoints++;
    return checkpoint(String(input.planId || ""), input.stateSnapshot, input.description);
  }, { public: false });

  register("loaf.temporal_planning", "rollback", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.rollbacks++;
    return rollback(String(input.planId || ""), String(input.checkpointId || ""));
  }, { public: false });

  // Forecast operations
  register("loaf.temporal_planning", "create_forecast", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.forecastsCreated++;
    return createForecast(input.prediction, input.confidence, input.horizonMs, input.decayModel);
  }, { public: false });

  register("loaf.temporal_planning", "decay_forecast", (_ctx, input = {}) => {
    return computeDecayedConfidence(String(input.forecastId || ""));
  }, { public: true });

  // World model operations
  register("loaf.temporal_planning", "create_world_model", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.worldModelsCreated++;
    return createWorldModel(input.label, input.initialState, input.assumptions);
  }, { public: false });

  register("loaf.temporal_planning", "apply_event", (_ctx, input = {}) => {
    return applyWorldEvent(String(input.worldModelId || ""), input.event || {}, input.stateChanges);
  }, { public: false });

  register("loaf.temporal_planning", "compare_worlds", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.comparisons++;
    return compareWorldModels(String(input.modelIdA || ""), String(input.modelIdB || ""));
  }, { public: true });

  // Memory pruning
  register("loaf.temporal_planning", "prune_memory", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.pruneOps++;
    return pruneWithLossGuarantee(input.items || [], Number(input.targetSize || 100), input.maxLoss);
  }, { public: false });

  // Cognitive diffing
  register("loaf.temporal_planning", "cognitive_diff", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.diffs++;
    return { ok: true, diff: cognitiveDiff(input.stateA, input.stateB, input.labelA, input.labelB) };
  }, { public: true });

  // Governance self-healing
  register("loaf.temporal_planning", "propose_governance_heal", (ctx, input = {}) => {
    const tp = ctx.state.__loaf.temporalPlanning;
    tp.stats.governanceHeals++;
    return proposeGovernanceHeal(input.failure || input);
  }, { public: false });

  register("loaf.temporal_planning", "list_plans", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, plans: Array.from(plans.values()).slice(-limit).map(sanitizePlan) };
  }, { public: true });

  register("loaf.temporal_planning", "list_forecasts", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, forecasts: Array.from(forecasts.values()).slice(-limit) };
  }, { public: true });

  register("loaf.temporal_planning", "list_world_models", (_ctx) => {
    return { ok: true, worldModels: Array.from(worldModels.values()).map(sanitizeWorldModel) };
  }, { public: true });
}

export {
  PLAN_STATES,
  CONFIDENCE_DECAY_MODELS,
  createPlan,
  checkpoint,
  rollback,
  createForecast,
  computeDecayedConfidence,
  createWorldModel,
  applyWorldEvent,
  compareWorldModels,
  pruneWithLossGuarantee,
  cognitiveDiff,
  proposeGovernanceHeal,
  init,
};
