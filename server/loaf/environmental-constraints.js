import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF X.1 — Environmental Constraints & Resource Modeling
 *
 * Capabilities (Environmental Constraints):
 *   1.  Resource modeling (compute, memory, time, bandwidth budgets)
 *   2.  Graceful degradation under resource pressure
 *   3.  Multi-resolution cognition (adapt reasoning depth to available resources)
 *   4.  Survival of meaning under compression
 *   5.  Cognitive triage under extreme constraints
 *   6.  Resource-aware scheduling of epistemic operations
 *   7.  Quality-of-service guarantees for critical knowledge operations
 *   8.  Resource contention detection and arbitration
 *   9.  Predictive resource exhaustion warnings
 *   10. Elastic cognition scaling (expand/contract with resources)
 *   11. Resource pooling across cognitive operations
 *   12. Minimum resource thresholds for safe operation
 *   13. Resource accounting and attribution
 *   14. Overhead monitoring and reduction
 *   15. Resource-cost transparency for all operations
 *
 * Design:
 *   - Every cognitive operation has a resource cost model
 *   - Degradation is graceful: reduce quality before failing
 *   - Multi-resolution cognition adapts reasoning depth dynamically
 *   - Critical operations get guaranteed resource minimums
 *   - Resource exhaustion is predicted before it happens
 *   - Triage under extreme pressure preserves most critical functions
 */

// === RESOURCE TYPES ===

const RESOURCE_TYPES = Object.freeze({
  COMPUTE: "compute",       // CPU/processing cycles
  MEMORY: "memory",         // working memory / RAM
  STORAGE: "storage",       // persistent storage
  TIME: "time",             // wall-clock time budgets
  BANDWIDTH: "bandwidth",   // I/O throughput
  ATTENTION: "attention",   // cognitive attention (limited resource)
});

const DEGRADATION_LEVELS = Object.freeze({
  FULL: "full",             // all features, full resolution
  REDUCED: "reduced",       // some features disabled, lower resolution
  MINIMAL: "minimal",       // only essential features
  TRIAGE: "triage",         // emergency: only critical operations
  SUSPENDED: "suspended",   // operations suspended, state preserved
});

const QOS_TIERS = Object.freeze({
  CRITICAL: "critical",     // guaranteed resources, never degraded
  HIGH: "high",             // best-effort high priority
  NORMAL: "normal",         // standard priority
  LOW: "low",               // degraded first under pressure
  BACKGROUND: "background", // only when spare resources exist
});

const MAX_BUDGETS = 200;
const MAX_OPERATIONS = 500;
const MAX_POOLS = 100;
const MAX_ALERTS = 300;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// budgetId -> { resourceType, total, used, reserved, operations[] }
const budgets = new LruMap();
// opId -> { name, costs{}, qosTier, degradationLevel, status }
const operations = new LruMap();
// poolId -> { resources{}, consumers[], maxConsumers }
const resourcePools = new LruMap();
// Alerts for predictive exhaustion
const exhaustionAlerts = new LruMap();
// Global degradation level
let globalDegradation = DEGRADATION_LEVELS.FULL;
// Resource accounting ledger
const accountingLedger = [];

// === BUDGET MANAGEMENT ===

/**
 * Create a resource budget.
 */
function createBudget(resourceType, total, label) {
  if (!Object.values(RESOURCE_TYPES).includes(resourceType)) {
    return { ok: false, error: `Unknown resource type: ${resourceType}` };
  }
  const id = `bud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(budgets, MAX_BUDGETS);

  budgets.set(id, {
    resourceType,
    label: label || resourceType,
    total,
    used: 0,
    reserved: 0,
    peakUsage: 0,
    operations: [],
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  });
  return { ok: true, budgetId: id };
}

/**
 * Reserve resources from a budget.
 */
function reserveResources(budgetId, amount, operationId) {
  const budget = budgets.get(budgetId);
  if (!budget) return { ok: false, error: "Budget not found" };

  const available = budget.total - budget.used - budget.reserved;
  if (amount > available) {
    return {
      ok: false,
      error: "Insufficient resources",
      available,
      requested: amount,
    };
  }

  budget.reserved += amount;
  budget.operations.push({ operationId, amount, type: "reserve", at: Date.now() });
  budget.lastUpdated = Date.now();

  recordAccounting(budgetId, "reserve", amount, operationId);
  return { ok: true, reserved: amount, remaining: budget.total - budget.used - budget.reserved };
}

/**
 * Consume (use) reserved or available resources.
 */
function consumeResources(budgetId, amount, operationId) {
  const budget = budgets.get(budgetId);
  if (!budget) return { ok: false, error: "Budget not found" };

  const available = budget.total - budget.used;
  if (amount > available) {
    return { ok: false, error: "Budget exhausted", available, requested: amount };
  }

  budget.used += amount;
  if (budget.reserved >= amount) budget.reserved -= amount;
  budget.peakUsage = Math.max(budget.peakUsage, budget.used);
  budget.operations.push({ operationId, amount, type: "consume", at: Date.now() });
  budget.lastUpdated = Date.now();

  // Keep operations bounded
  if (budget.operations.length > 100) budget.operations = budget.operations.slice(-50);

  recordAccounting(budgetId, "consume", amount, operationId);

  // Check for predictive exhaustion
  checkExhaustion(budgetId);

  return { ok: true, consumed: amount, remaining: budget.total - budget.used };
}

/**
 * Release previously consumed resources back to the budget.
 */
function releaseResources(budgetId, amount, operationId) {
  const budget = budgets.get(budgetId);
  if (!budget) return { ok: false, error: "Budget not found" };

  budget.used = Math.max(0, budget.used - amount);
  budget.operations.push({ operationId, amount, type: "release", at: Date.now() });
  budget.lastUpdated = Date.now();

  recordAccounting(budgetId, "release", amount, operationId);
  return { ok: true, released: amount, remaining: budget.total - budget.used };
}

/**
 * Get budget status including utilization metrics.
 */
function getBudgetStatus(budgetId) {
  const budget = budgets.get(budgetId);
  if (!budget) return { ok: false, error: "Budget not found" };

  const utilization = budget.total > 0 ? budget.used / budget.total : 0;
  return {
    ok: true,
    budgetId,
    resourceType: budget.resourceType,
    label: budget.label,
    total: budget.total,
    used: budget.used,
    reserved: budget.reserved,
    available: budget.total - budget.used - budget.reserved,
    utilization,
    peakUtilization: budget.total > 0 ? budget.peakUsage / budget.total : 0,
  };
}

// === PREDICTIVE EXHAUSTION ===

/**
 * Check for resource exhaustion and generate predictive alerts.
 */
function checkExhaustion(budgetId) {
  const budget = budgets.get(budgetId);
  if (!budget) return;

  const utilization = budget.total > 0 ? budget.used / budget.total : 0;

  // Compute consumption rate from recent operations
  const recentConsumes = budget.operations
    .filter(o => o.type === "consume" && Date.now() - o.at < 60000)
    .reduce((s, o) => s + o.amount, 0);
  const remaining = budget.total - budget.used;
  const secondsUntilExhaustion = recentConsumes > 0
    ? (remaining / (recentConsumes / 60)) // at current rate
    : Infinity;

  if (utilization > 0.8 || secondsUntilExhaustion < 300) {
    const alertId = `alert_${budgetId}`;
    capMap(exhaustionAlerts, MAX_ALERTS);
    exhaustionAlerts.set(alertId, {
      budgetId,
      utilization,
      secondsUntilExhaustion: Math.round(secondsUntilExhaustion),
      severity: utilization > 0.95 ? "critical" : utilization > 0.9 ? "high" : "warning",
      createdAt: Date.now(),
    });
  }
}

/**
 * Get all active exhaustion alerts.
 */
function getExhaustionAlerts() {
  const alerts = [];
  for (const [id, alert] of exhaustionAlerts) {
    // Only return recent alerts
    if (Date.now() - alert.createdAt < 300000) {
      alerts.push({ alertId: id, ...alert });
    }
  }
  alerts.sort((a, b) => {
    const sevOrder = { critical: 0, high: 1, warning: 2 };
    return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
  });
  return { ok: true, alerts, count: alerts.length };
}

// === MULTI-RESOLUTION COGNITION ===

/**
 * Register a cognitive operation with its resource costs at different resolutions.
 */
function registerOperation(name, costs, qosTier) {
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(operations, MAX_OPERATIONS);

  operations.set(id, {
    name,
    costs: {
      full: costs.full || {},
      reduced: costs.reduced || {},
      minimal: costs.minimal || {},
    },
    qosTier: qosTier || QOS_TIERS.NORMAL,
    currentResolution: DEGRADATION_LEVELS.FULL,
    executions: 0,
    totalCost: {},
    createdAt: Date.now(),
  });
  return { ok: true, operationId: id };
}

/**
 * Determine the appropriate resolution for an operation given current resources.
 */
function selectResolution(operationId, availableResources) {
  const op = operations.get(operationId);
  if (!op) return { ok: false, error: "Operation not found" };

  // Check if we can run at full resolution
  const canRunFull = canAfford(op.costs.full, availableResources);
  const canRunReduced = canAfford(op.costs.reduced, availableResources);
  const canRunMinimal = canAfford(op.costs.minimal, availableResources);

  // QoS tier affects degradation willingness
  if (op.qosTier === QOS_TIERS.CRITICAL && !canRunFull) {
    return {
      ok: false,
      error: "Critical operation cannot be degraded — insufficient resources",
      operationId,
      qosTier: op.qosTier,
    };
  }

  let selectedResolution;
  if (canRunFull && globalDegradation === DEGRADATION_LEVELS.FULL) {
    selectedResolution = DEGRADATION_LEVELS.FULL;
  } else if (canRunReduced) {
    selectedResolution = DEGRADATION_LEVELS.REDUCED;
  } else if (canRunMinimal) {
    selectedResolution = DEGRADATION_LEVELS.MINIMAL;
  } else {
    selectedResolution = DEGRADATION_LEVELS.SUSPENDED;
  }

  op.currentResolution = selectedResolution;
  return {
    ok: true,
    operationId,
    resolution: selectedResolution,
    costs: op.costs[selectedResolution] || op.costs.minimal,
  };
}

/**
 * Check if available resources can afford a cost.
 */
function canAfford(costs, available) {
  if (!costs || !available) return true;
  for (const [resource, amount] of Object.entries(costs)) {
    if ((available[resource] || 0) < amount) return false;
  }
  return true;
}

/**
 * Set global degradation level (affects all operations).
 */
function setGlobalDegradation(level) {
  if (!Object.values(DEGRADATION_LEVELS).includes(level)) {
    return { ok: false, error: `Unknown degradation level: ${level}` };
  }
  const previous = globalDegradation;
  globalDegradation = level;
  return { ok: true, previous, current: level };
}

/**
 * Get current global degradation level.
 */
function getGlobalDegradation() {
  return { ok: true, level: globalDegradation };
}

// === COGNITIVE TRIAGE ===

/**
 * Perform cognitive triage — under extreme pressure, decide what to keep running.
 */
function performTriage(availableResources) {
  const allOps = [...operations.entries()];

  // Sort by QoS tier priority
  const tierOrder = {
    [QOS_TIERS.CRITICAL]: 0,
    [QOS_TIERS.HIGH]: 1,
    [QOS_TIERS.NORMAL]: 2,
    [QOS_TIERS.LOW]: 3,
    [QOS_TIERS.BACKGROUND]: 4,
  };
  allOps.sort((a, b) => (tierOrder[a[1].qosTier] || 5) - (tierOrder[b[1].qosTier] || 5));

  const keep = [];
  const suspend = [];
  const remainingResources = { ...availableResources };

  for (const [id, op] of allOps) {
    // Try minimal cost first for triage
    const minCost = op.costs.minimal || {};
    if (canAfford(minCost, remainingResources)) {
      keep.push({ operationId: id, name: op.name, qosTier: op.qosTier, resolution: DEGRADATION_LEVELS.MINIMAL });
      for (const [r, amt] of Object.entries(minCost)) {
        remainingResources[r] = (remainingResources[r] || 0) - amt;
      }
    } else {
      suspend.push({ operationId: id, name: op.name, qosTier: op.qosTier });
      op.currentResolution = DEGRADATION_LEVELS.SUSPENDED;
    }
  }

  return {
    ok: true,
    keep: keep.length,
    suspend: suspend.length,
    kept: keep,
    suspended: suspend,
    remainingResources,
  };
}

// === RESOURCE POOLS ===

/**
 * Create a shared resource pool.
 */
function createPool(name, resources, maxConsumers) {
  const id = `pool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(resourcePools, MAX_POOLS);

  resourcePools.set(id, {
    name,
    resources: { ...resources },
    originalResources: { ...resources },
    consumers: [],
    maxConsumers: maxConsumers || 10,
    createdAt: Date.now(),
  });
  return { ok: true, poolId: id };
}

/**
 * Draw resources from a pool.
 */
function drawFromPool(poolId, consumerId, amounts) {
  const pool = resourcePools.get(poolId);
  if (!pool) return { ok: false, error: "Pool not found" };
  if (pool.consumers.length >= pool.maxConsumers && !pool.consumers.includes(consumerId)) {
    return { ok: false, error: "Pool at consumer capacity" };
  }

  if (!canAfford(amounts, pool.resources)) {
    return { ok: false, error: "Insufficient pool resources" };
  }

  for (const [r, amt] of Object.entries(amounts)) {
    pool.resources[r] = (pool.resources[r] || 0) - amt;
  }
  if (!pool.consumers.includes(consumerId)) pool.consumers.push(consumerId);

  return { ok: true, drawn: amounts, remaining: { ...pool.resources } };
}

/**
 * Return resources to a pool.
 */
function returnToPool(poolId, consumerId, amounts) {
  const pool = resourcePools.get(poolId);
  if (!pool) return { ok: false, error: "Pool not found" };

  for (const [r, amt] of Object.entries(amounts)) {
    pool.resources[r] = Math.min(
      (pool.resources[r] || 0) + amt,
      pool.originalResources[r] || Infinity
    );
  }

  return { ok: true, returned: amounts, remaining: { ...pool.resources } };
}

// === MINIMUM RESOURCE THRESHOLDS ===

/**
 * Define minimum resource thresholds for safe operation.
 */
const safetyThresholds = new LruMap();

function defineSafetyThreshold(resourceType, minimum, action) {
  safetyThresholds.set(resourceType, {
    minimum,
    action: action || "degrade", // degrade | halt | alert
    createdAt: Date.now(),
  });
  return { ok: true, resourceType, minimum, action };
}

/**
 * Check all safety thresholds against current resource levels.
 */
function checkSafetyThresholds(currentResources) {
  const violations = [];

  for (const [resourceType, threshold] of safetyThresholds) {
    const current = currentResources[resourceType] || 0;
    if (current < threshold.minimum) {
      violations.push({
        resourceType,
        current,
        minimum: threshold.minimum,
        deficit: threshold.minimum - current,
        action: threshold.action,
      });
    }
  }

  return {
    ok: true,
    safe: violations.length === 0,
    violations,
    action: violations.some(v => v.action === "halt") ? "halt"
      : violations.some(v => v.action === "degrade") ? "degrade"
      : violations.length > 0 ? "alert" : "none",
  };
}

// === RESOURCE ACCOUNTING ===

/**
 * Record a resource accounting entry.
 */
function recordAccounting(budgetId, type, amount, operationId) {
  accountingLedger.push({
    budgetId,
    type,
    amount,
    operationId,
    timestamp: Date.now(),
  });
  // Bound the ledger
  if (accountingLedger.length > 2000) {
    accountingLedger.splice(0, accountingLedger.length - 1000);
  }
}

/**
 * Get resource accounting summary.
 */
function getAccountingSummary(sinceTimestamp) {
  const since = sinceTimestamp || 0;
  const entries = accountingLedger.filter(e => e.timestamp >= since);

  const byBudget = {};
  const byOperation = {};
  for (const e of entries) {
    if (!byBudget[e.budgetId]) byBudget[e.budgetId] = { consumed: 0, released: 0, reserved: 0 };
    byBudget[e.budgetId][e.type === "consume" ? "consumed" : e.type === "release" ? "released" : "reserved"] += e.amount;

    if (e.operationId) {
      if (!byOperation[e.operationId]) byOperation[e.operationId] = 0;
      if (e.type === "consume") byOperation[e.operationId] += e.amount;
    }
  }

  return {
    ok: true,
    entries: entries.length,
    byBudget,
    byOperation,
    totalConsumed: entries.filter(e => e.type === "consume").reduce((s, e) => s + e.amount, 0),
    totalReleased: entries.filter(e => e.type === "release").reduce((s, e) => s + e.amount, 0),
  };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "create_resource_budget", (ctx) => {
    const { resourceType, total, label } = ctx.args || {};
    return createBudget(resourceType, total, label);
  }, { public: true });

  register("loaf", "reserve_resources", (ctx) => {
    const { budgetId, amount, operationId } = ctx.args || {};
    return reserveResources(budgetId, amount, operationId);
  }, { public: true });

  register("loaf", "consume_resources", (ctx) => {
    const { budgetId, amount, operationId } = ctx.args || {};
    return consumeResources(budgetId, amount, operationId);
  }, { public: true });

  register("loaf", "release_resources", (ctx) => {
    const { budgetId, amount, operationId } = ctx.args || {};
    return releaseResources(budgetId, amount, operationId);
  }, { public: true });

  register("loaf", "budget_status", (ctx) => {
    return getBudgetStatus(ctx.args?.budgetId);
  }, { public: true });

  register("loaf", "exhaustion_alerts", (_ctx) => {
    return getExhaustionAlerts();
  }, { public: true });

  register("loaf", "register_operation", (ctx) => {
    const { name, costs, qosTier } = ctx.args || {};
    return registerOperation(name, costs || {}, qosTier);
  }, { public: true });

  register("loaf", "select_resolution", (ctx) => {
    const { operationId, availableResources } = ctx.args || {};
    return selectResolution(operationId, availableResources);
  }, { public: true });

  register("loaf", "set_degradation", (ctx) => {
    return setGlobalDegradation(ctx.args?.level);
  }, { public: true });

  register("loaf", "get_degradation", (_ctx) => {
    return getGlobalDegradation();
  }, { public: true });

  register("loaf", "perform_triage", (ctx) => {
    return performTriage(ctx.args?.availableResources || {});
  }, { public: true });

  register("loaf", "create_resource_pool", (ctx) => {
    const { name, resources, maxConsumers } = ctx.args || {};
    return createPool(name, resources || {}, maxConsumers);
  }, { public: true });

  register("loaf", "draw_from_pool", (ctx) => {
    const { poolId, consumerId, amounts } = ctx.args || {};
    return drawFromPool(poolId, consumerId, amounts || {});
  }, { public: true });

  register("loaf", "return_to_pool", (ctx) => {
    const { poolId, consumerId, amounts } = ctx.args || {};
    return returnToPool(poolId, consumerId, amounts || {});
  }, { public: true });

  register("loaf", "define_safety_threshold", (ctx) => {
    const { resourceType, minimum, action } = ctx.args || {};
    return defineSafetyThreshold(resourceType, minimum, action);
  }, { public: true });

  register("loaf", "check_safety_thresholds", (ctx) => {
    return checkSafetyThresholds(ctx.args?.currentResources || {});
  }, { public: true });

  register("loaf", "resource_accounting", (ctx) => {
    return getAccountingSummary(ctx.args?.since);
  }, { public: true });
}

export {
  init,
  RESOURCE_TYPES,
  DEGRADATION_LEVELS,
  QOS_TIERS,
  createBudget,
  reserveResources,
  consumeResources,
  releaseResources,
  getBudgetStatus,
  checkExhaustion,
  getExhaustionAlerts,
  registerOperation,
  selectResolution,
  canAfford,
  setGlobalDegradation,
  getGlobalDegradation,
  performTriage,
  createPool,
  drawFromPool,
  returnToPool,
  defineSafetyThreshold,
  checkSafetyThresholds,
  getAccountingSummary,
};
