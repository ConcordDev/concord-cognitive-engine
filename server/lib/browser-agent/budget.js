// server/lib/browser-agent/budget.js
//
// Per-user + per-task cost tracking and budget enforcement.
//
// Cost model is intentionally coarse:
//   ACTION_COST_CENTS — every browser action costs 1¢ (page load,
//                       click, screenshot are all "1 unit of work")
//   TOKEN_COST_PER_1K  — LLM-token cost per 1k tokens at default
//                        utility-brain rate (0.02¢ for local
//                        inference; tune via env)
//
// The point is observability, not perfect accounting. If concord
// later wires real provider invoices, swap this for the per-call
// receipts.

const ACTION_COST_CENTS = Number(process.env.CONCORD_BROWSER_ACTION_CENTS || 1);
const TOKEN_COST_PER_1K_CENTS = Number(process.env.CONCORD_BROWSER_TOKEN_CENTS_PER_1K || 0.02);

export function costForAction({ kind, tokens = 0 } = {}) {
  const actionCost = kind === "approval" || kind === "wait" ? 0 : ACTION_COST_CENTS;
  const tokenCost = Math.round((tokens / 1000) * TOKEN_COST_PER_1K_CENTS * 100) / 100;
  return { cents: actionCost + tokenCost, actionCents: actionCost, tokenCents: tokenCost };
}

const DEFAULT_BUDGET = {
  daily_cents_cap: 500,
  monthly_cents_cap: 5000,
  per_task_default_cents: 100,
  concurrent_task_max: 3,
  approval_mode_default: "destructive_only",
};

export function getBudget(db, userId) {
  if (!db || !userId) return { ...DEFAULT_BUDGET, user_id: userId || null };
  const row = db.prepare(`SELECT * FROM browser_task_budgets WHERE user_id = ?`).get(userId);
  return row || { ...DEFAULT_BUDGET, user_id: userId };
}

export function upsertBudget(db, userId, patch = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_args" };
  const current = getBudget(db, userId);
  const merged = { ...current, ...patch };
  db.prepare(`
    INSERT INTO browser_task_budgets
      (user_id, daily_cents_cap, monthly_cents_cap, per_task_default_cents,
       concurrent_task_max, approval_mode_default, tool_default_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      daily_cents_cap = excluded.daily_cents_cap,
      monthly_cents_cap = excluded.monthly_cents_cap,
      per_task_default_cents = excluded.per_task_default_cents,
      concurrent_task_max = excluded.concurrent_task_max,
      approval_mode_default = excluded.approval_mode_default,
      tool_default_json = excluded.tool_default_json,
      updated_at = excluded.updated_at
  `).run(userId,
    Math.max(0, Number(merged.daily_cents_cap) || 0),
    Math.max(0, Number(merged.monthly_cents_cap) || 0),
    Math.max(0, Number(merged.per_task_default_cents) || 0),
    Math.max(0, Math.min(20, Number(merged.concurrent_task_max ?? 3))),
    ["off","destructive_only","every_step"].includes(merged.approval_mode_default) ? merged.approval_mode_default : "destructive_only",
    merged.tool_default_json ? String(merged.tool_default_json) : null);
  return { ok: true };
}

export function dailySpentCents(db, userId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !userId) return 0;
  const cutoff = now - 86400;
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_cost_cents), 0) AS total
    FROM browser_tasks WHERE user_id = ? AND updated_at >= ?
  `).get(userId, cutoff);
  return row?.total || 0;
}

export function monthlySpentCents(db, userId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !userId) return 0;
  const cutoff = now - 30 * 86400;
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_cost_cents), 0) AS total
    FROM browser_tasks WHERE user_id = ? AND updated_at >= ?
  `).get(userId, cutoff);
  return row?.total || 0;
}

/**
 * Returns { ok, reason?, remaining } — whether a single new action's
 * cost can be added to the task without exceeding any cap.
 */
export function canSpend(db, task, actionCostCents = ACTION_COST_CENTS) {
  if (!db || !task) return { ok: false, reason: "missing_args" };
  // Per-task cap
  const taskCap = task.max_cost_cents != null ? task.max_cost_cents : getBudget(db, task.user_id).per_task_default_cents;
  if ((task.total_cost_cents || 0) + actionCostCents > taskCap) {
    return { ok: false, reason: "task_budget_exceeded", remainingTask: 0, taskCap };
  }
  // Daily / monthly caps
  const budget = getBudget(db, task.user_id);
  const day = dailySpentCents(db, task.user_id);
  if (day + actionCostCents > budget.daily_cents_cap) return { ok: false, reason: "daily_budget_exceeded", dailySpent: day, dailyCap: budget.daily_cents_cap };
  const mo = monthlySpentCents(db, task.user_id);
  if (mo + actionCostCents > budget.monthly_cents_cap) return { ok: false, reason: "monthly_budget_exceeded", monthlySpent: mo, monthlyCap: budget.monthly_cents_cap };
  return { ok: true, remainingTask: taskCap - (task.total_cost_cents || 0) - actionCostCents, dailySpent: day + actionCostCents, monthlySpent: mo + actionCostCents };
}

export function concurrentActive(db, userId) {
  if (!db || !userId) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM browser_tasks
    WHERE user_id = ? AND status IN ('pending','planning','awaiting_approval','running','paused')
  `).get(userId);
  return row?.n || 0;
}

export function canStartAnother(db, userId) {
  const budget = getBudget(db, userId);
  const live = concurrentActive(db, userId);
  if (live >= budget.concurrent_task_max) {
    return { ok: false, reason: "concurrent_limit", live, limit: budget.concurrent_task_max };
  }
  return { ok: true, live, limit: budget.concurrent_task_max };
}
