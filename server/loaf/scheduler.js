import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF I.5 — Scheduler Hardening + LOAF I.6 — Unified Rate Budget
 *
 * Scheduler:
 * - Priority aging (older tasks gain priority)
 * - Time slicing (fair CPU sharing)
 * - Background quota
 * - Max thread lifetime
 * - Starvation prevention
 *
 * Rate Budget:
 * Single function: consumeBudget(actor, domain, cost)
 * Applied at: HTTP entry, macro execution, kernelTick, background tasks
 */

const SCHEDULER_CONFIG = Object.freeze({
  // Priority aging
  agingIntervalMs: 60000,            // check every minute
  agingIncrement: 0.1,               // priority boost per interval
  maxPriority: 10,
  // Time slicing
  defaultTimeSliceMs: 100,           // 100ms default slice
  maxTimeSliceMs: 5000,              // 5s max
  // Background quota
  backgroundQuotaPct: 0.20,          // 20% of capacity reserved for background
  maxBackgroundConcurrent: 5,
  // Thread lifetime
  maxThreadLifetimeMs: 300000,       // 5 minutes max
  // Starvation prevention
  starvationThresholdMs: 30000,      // if waiting > 30s, force-promote
  starvationBoostPriority: 8,
});

const BUDGET_CONFIG = Object.freeze({
  // Per-actor budgets (per window)
  defaultBudgetPerWindow: 1000,
  windowMs: 60000,                    // 1 minute
  // Domain-specific costs
  domainCosts: {
    "http": 1,
    "macro": 5,
    "kernelTick": 2,
    "background": 3,
    "transfer": 10,
    "world.write": 8,
    "canon.promote": 15,
    "economy.distribute": 20,
  },
});

// Actor budget tracking
const budgets = new LruMap(); // actorId -> { used, windowStart, entries[] }

// Scheduler task queue
const schedulerQueue = [];
// Active threads tracking
const activeThreads = new Map(); // threadId -> { id, priority, startedAt, timeSliceMs, isBackground }

/**
 * consumeBudget — single unified rate-limiting function.
 * Returns { allowed, remaining, cost, reason }
 */
function consumeBudget(actor, domain, cost = null, config = BUDGET_CONFIG) {
  const actorId = typeof actor === "string" ? actor : (actor?.id || "anonymous");
  const now = Date.now();

  // Determine cost
  const effectiveCost = cost ?? (config.domainCosts[domain] || 1);

  // Get or create budget entry
  if (!budgets.has(actorId)) {
    budgets.set(actorId, { used: 0, windowStart: now, entries: [] });
  }

  const budget = budgets.get(actorId);

  // Reset window if expired
  if (now - budget.windowStart >= config.windowMs) {
    budget.used = 0;
    budget.windowStart = now;
    budget.entries = [];
  }

  // Check budget
  const limit = config.defaultBudgetPerWindow;
  if (budget.used + effectiveCost > limit) {
    return {
      allowed: false,
      remaining: Math.max(0, limit - budget.used),
      cost: effectiveCost,
      reason: "budget_exceeded",
      resetInMs: config.windowMs - (now - budget.windowStart),
    };
  }

  // Consume
  budget.used += effectiveCost;
  budget.entries.push({ domain, cost: effectiveCost, ts: now });

  return {
    allowed: true,
    remaining: limit - budget.used,
    cost: effectiveCost,
    reason: "ok",
  };
}

/**
 * Get current budget status for an actor.
 */
function getBudgetStatus(actorId, config = BUDGET_CONFIG) {
  const now = Date.now();
  const budget = budgets.get(actorId);
  if (!budget) return { actorId, used: 0, limit: config.defaultBudgetPerWindow, remaining: config.defaultBudgetPerWindow };

  // Check if window expired
  if (now - budget.windowStart >= config.windowMs) {
    return { actorId, used: 0, limit: config.defaultBudgetPerWindow, remaining: config.defaultBudgetPerWindow };
  }

  return {
    actorId,
    used: budget.used,
    limit: config.defaultBudgetPerWindow,
    remaining: Math.max(0, config.defaultBudgetPerWindow - budget.used),
    resetInMs: config.windowMs - (now - budget.windowStart),
    entries: budget.entries.length,
  };
}

/**
 * Schedule a task with priority aging and starvation prevention.
 */
function scheduleTask(task, config = SCHEDULER_CONFIG) {
  const entry = {
    id: task.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    priority: Math.min(Number(task.priority || 5), config.maxPriority),
    originalPriority: Number(task.priority || 5),
    isBackground: Boolean(task.isBackground),
    createdAt: Date.now(),
    lastAgedAt: Date.now(),
    timeSliceMs: Math.min(Number(task.timeSliceMs || config.defaultTimeSliceMs), config.maxTimeSliceMs),
    payload: task.payload || {},
    status: "queued",
  };

  schedulerQueue.push(entry);
  // Sort by priority (descending)
  schedulerQueue.sort((a, b) => b.priority - a.priority);

  // Cap queue size to prevent unbounded growth
  if (schedulerQueue.length > 10000) {
    schedulerQueue.splice(10000);
  }

  return { ok: true, task: entry, queuePosition: schedulerQueue.indexOf(entry) };
}

/**
 * Apply priority aging to all queued tasks.
 * Older tasks gradually gain priority (starvation prevention).
 */
function applyPriorityAging(config = SCHEDULER_CONFIG) {
  const now = Date.now();
  let aged = 0;
  let starvationPromoted = 0;

  for (const task of schedulerQueue) {
    if (task.status !== "queued") continue;

    const waitTime = now - task.createdAt;
    const timeSinceLastAge = now - task.lastAgedAt;

    // Regular aging
    if (timeSinceLastAge >= config.agingIntervalMs) {
      const increments = Math.floor(timeSinceLastAge / config.agingIntervalMs);
      task.priority = Math.min(task.priority + config.agingIncrement * increments, config.maxPriority);
      task.lastAgedAt = now;
      aged++;
    }

    // Starvation prevention: force-promote if waiting too long
    if (waitTime >= config.starvationThresholdMs && task.priority < config.starvationBoostPriority) {
      task.priority = config.starvationBoostPriority;
      starvationPromoted++;
    }
  }

  // Re-sort
  schedulerQueue.sort((a, b) => b.priority - a.priority);

  return { aged, starvationPromoted, queueSize: schedulerQueue.length };
}

/**
 * Dequeue next task respecting background quota.
 */
function dequeueNext(config = SCHEDULER_CONFIG) {
  if (schedulerQueue.length === 0) return { ok: false, reason: "queue_empty" };

  // Count active background threads
  const activeBackground = Array.from(activeThreads.values()).filter(t => t.isBackground).length;

  // Apply aging before dequeue
  applyPriorityAging(config);

  // Find next eligible task
  for (let i = 0; i < schedulerQueue.length; i++) {
    const task = schedulerQueue[i];
    if (task.status !== "queued") continue;

    // Check background quota
    if (task.isBackground && activeBackground >= config.maxBackgroundConcurrent) {
      continue;
    }

    // Dequeue
    task.status = "active";
    schedulerQueue.splice(i, 1);

    // Track as active thread
    activeThreads.set(task.id, {
      id: task.id,
      priority: task.priority,
      startedAt: Date.now(),
      timeSliceMs: task.timeSliceMs,
      isBackground: task.isBackground,
    });

    return { ok: true, task };
  }

  return { ok: false, reason: "no_eligible_tasks" };
}

/**
 * Complete a thread and remove from active tracking.
 */
function completeThread(threadId) {
  const thread = activeThreads.get(threadId);
  if (!thread) return { ok: false, error: "thread_not_found" };
  activeThreads.delete(threadId);
  return { ok: true, thread, duration: Date.now() - thread.startedAt };
}

/**
 * Enforce max thread lifetime — terminate threads that exceed the limit.
 */
function enforceThreadLifetimes(config = SCHEDULER_CONFIG) {
  const now = Date.now();
  const terminated = [];

  for (const [id, thread] of activeThreads) {
    if (now - thread.startedAt > config.maxThreadLifetimeMs) {
      terminated.push({ id, duration: now - thread.startedAt });
      activeThreads.delete(id);
    }
  }

  return { terminated, activeCount: activeThreads.size };
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.scheduler = {
    config: { ...SCHEDULER_CONFIG },
    budgetConfig: { ...BUDGET_CONFIG },
    stats: {
      tasksScheduled: 0, tasksDequeued: 0, tasksCompleted: 0, threadsTerminated: 0,
      budgetChecks: 0, budgetDenials: 0, agingRuns: 0, starvationPromotions: 0,
    },
  };

  register("loaf.scheduler", "status", (ctx) => {
    const s = ctx.state.__loaf.scheduler;
    return {
      ok: true,
      queueSize: schedulerQueue.length,
      activeThreads: activeThreads.size,
      config: s.config,
      budgetConfig: s.budgetConfig,
      stats: s.stats,
    };
  }, { public: true });

  register("loaf.scheduler", "schedule", (ctx, input = {}) => {
    const s = ctx.state.__loaf.scheduler;
    const result = scheduleTask(input, s.config);
    if (result.ok) s.stats.tasksScheduled++;
    return result;
  }, { public: false });

  register("loaf.scheduler", "dequeue", (ctx) => {
    const s = ctx.state.__loaf.scheduler;
    const result = dequeueNext(s.config);
    if (result.ok) s.stats.tasksDequeued++;
    return result;
  }, { public: false });

  register("loaf.scheduler", "complete", (ctx, input = {}) => {
    const s = ctx.state.__loaf.scheduler;
    const result = completeThread(String(input.threadId || input.id || ""));
    if (result.ok) s.stats.tasksCompleted++;
    return result;
  }, { public: false });

  register("loaf.scheduler", "age", (ctx) => {
    const s = ctx.state.__loaf.scheduler;
    const result = applyPriorityAging(s.config);
    s.stats.agingRuns++;
    s.stats.starvationPromotions += result.starvationPromoted;
    return { ok: true, ...result };
  }, { public: false });

  register("loaf.scheduler", "enforce_lifetimes", (ctx) => {
    const s = ctx.state.__loaf.scheduler;
    const result = enforceThreadLifetimes(s.config);
    s.stats.threadsTerminated += result.terminated.length;
    return { ok: true, ...result };
  }, { public: false });

  register("loaf.scheduler", "consume_budget", (ctx, input = {}) => {
    const s = ctx.state.__loaf.scheduler;
    s.stats.budgetChecks++;
    const actorId = String(input.actorId || ctx.actor?.id || "anonymous");
    const result = consumeBudget(actorId, String(input.domain || ""), input.cost, s.budgetConfig);
    if (!result.allowed) s.stats.budgetDenials++;
    return { ok: true, ...result };
  }, { public: true });

  register("loaf.scheduler", "budget_status", (ctx, input = {}) => {
    const s = ctx.state.__loaf.scheduler;
    const actorId = String(input.actorId || ctx.actor?.id || "anonymous");
    return { ok: true, ...getBudgetStatus(actorId, s.budgetConfig) };
  }, { public: true });

  register("loaf.scheduler", "queue", (_ctx) => {
    const tasks = schedulerQueue.map(t => ({
      id: t.id, priority: t.priority, originalPriority: t.originalPriority,
      isBackground: t.isBackground, status: t.status,
      waitingMs: Date.now() - t.createdAt,
    }));
    return { ok: true, tasks };
  }, { public: true });
}

export {
  SCHEDULER_CONFIG,
  BUDGET_CONFIG,
  consumeBudget,
  getBudgetStatus,
  scheduleTask,
  applyPriorityAging,
  dequeueNext,
  completeThread,
  enforceThreadLifetimes,
  init,
};
