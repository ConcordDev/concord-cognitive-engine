// server/domains/browser-agent.js
//
// Browser Agent lens Sprint A — task orchestration + safety +
// observability on top of the existing browser-engine.js + chat-agent
// + agent-marathon infrastructure (no smoking-gun fix needed; the
// substrate is wired). ~20 macros covering task CRUD + state
// transitions + action audit log + per-step recording + approval
// gates + per-user budget settings.

import {
  createTask, getTask, listTasksForUser, transitionTask,
  recordAction, listActions, listPendingApprovals, decideApproval,
} from "../lib/browser-agent/audit.js";
import {
  getBudget, upsertBudget, dailySpentCents, monthlySpentCents,
  concurrentActive, canStartAnother,
} from "../lib/browser-agent/budget.js";
import { isDestructive, requiresApproval, approvalReason } from "../lib/browser-agent/safety.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`browser-task:${payload.taskId}`).emit(event, payload); } catch { /* best effort */ }
}

export default function registerBrowserAgentMacros(register) {

  // ─── Task CRUD ───────────────────────────────────────────────────

  register("browser-agent", "task_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = createTask(db, {
      userId,
      title: input.title,
      goal: input.goal,
      startingUrl: input.startingUrl,
      approvalMode: input.approvalMode,
      maxSteps: input.maxSteps,
      maxCostCents: input.maxCostCents,
      toolAllowlist: input.toolAllowlist,
      contextIsolated: input.contextIsolated !== false,
      userAgent: input.userAgent,
      geoRegion: input.geoRegion,
      proxyUrl: input.proxyUrl,
      marathonSessionId: input.marathonSessionId,
    });
    if (r.ok) _emit("browser-task:created", { taskId: r.id, userId });
    return r;
  }, { destructive: true, note: "Create a browser-agent task (auth + concurrent-cap gated)" });

  register("browser-agent", "task_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (task.user_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, task };
  }, { note: "Get a browser task with current status + counters" });

  register("browser-agent", "task_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const tasks = listTasksForUser(db, userId, { status: input.status, limit: input.limit });
    return { ok: true, tasks, count: tasks.length };
  }, { note: "List my browser tasks (optional status filter)" });

  register("browser-agent", "task_pause", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    if (!["running","planning","awaiting_approval"].includes(task.status)) return { ok: false, reason: "not_running" };
    const r = transitionTask(db, task.id, "paused");
    if (r.ok) _emit("browser-task:paused", { taskId: task.id });
    return r;
  }, { destructive: true, note: "Pause a running task" });

  register("browser-agent", "task_resume", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    if (task.status !== "paused") return { ok: false, reason: "not_paused" };
    const r = transitionTask(db, task.id, "running");
    if (r.ok) _emit("browser-task:resumed", { taskId: task.id });
    return r;
  }, { destructive: true, note: "Resume a paused task" });

  register("browser-agent", "task_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const r = transitionTask(db, task.id, "cancelled", { result_summary: input.note || "User cancelled" });
    if (r.ok) _emit("browser-task:cancelled", { taskId: task.id });
    return r;
  }, { destructive: true, note: "Stop / cancel a running task" });

  register("browser-agent", "task_complete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const r = transitionTask(db, task.id, "completed", {
      completed_at: _now(),
      result_summary: input.summary,
    });
    if (r.ok) _emit("browser-task:completed", { taskId: task.id, summary: input.summary });
    return r;
  }, { destructive: true, note: "Mark a task as completed (orchestrator + UI close-out)" });

  // ─── Action log ──────────────────────────────────────────────────

  register("browser-agent", "action_record", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const r = recordAction(db, taskId, input.action || input);
    if (r.ok) _emit("browser-task:action", { taskId, action: input.action || input, stepIndex: r.stepIndex });
    else if (r.reason === "approval_required") _emit("browser-task:approval-pending", { taskId, approvalId: r.approvalId });
    return r;
  }, { destructive: true, note: "Record a single agent step (cost+safety gated)" });

  register("browser-agent", "actions_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    return { ok: true, actions: listActions(db, task.id, { limit: input.limit, since: input.since }) };
  }, { note: "List actions in a task (replay / LiveView feed)" });

  register("browser-agent", "action_check_destructive", async (_ctx, input = {}) => {
    return { ok: true, destructive: isDestructive(input.action || input) };
  }, { note: "Tell me whether an action would be flagged destructive (no DB)" });

  // ─── Approvals ───────────────────────────────────────────────────

  register("browser-agent", "approvals_pending", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, approvals: listPendingApprovals(db, userId) };
  }, { note: "List my pending approval requests" });

  register("browser-agent", "approval_decide", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = decideApproval(db, Number(input.approvalId), {
      userId,
      decision: input.decision,
      note: input.note,
    });
    if (r.ok) _emit("browser-task:approval-decided", { taskId: r.taskId, decision: input.decision });
    return r;
  }, { destructive: true, note: "Approve or reject a pending step" });

  // ─── Budgets ─────────────────────────────────────────────────────

  register("browser-agent", "budget_get", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return {
      ok: true,
      budget: getBudget(db, userId),
      dailySpentCents: dailySpentCents(db, userId),
      monthlySpentCents: monthlySpentCents(db, userId),
      concurrentActive: concurrentActive(db, userId),
    };
  }, { note: "Get my budget + current spend + concurrent active count" });

  register("browser-agent", "budget_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Accept either camelCase from JSON API or snake_case from internal callers
    const patch = {};
    if (input.dailyCentsCap != null || input.daily_cents_cap != null) patch.daily_cents_cap = input.dailyCentsCap ?? input.daily_cents_cap;
    if (input.monthlyCentsCap != null || input.monthly_cents_cap != null) patch.monthly_cents_cap = input.monthlyCentsCap ?? input.monthly_cents_cap;
    if (input.perTaskDefaultCents != null || input.per_task_default_cents != null) patch.per_task_default_cents = input.perTaskDefaultCents ?? input.per_task_default_cents;
    if (input.concurrentTaskMax != null || input.concurrent_task_max != null) patch.concurrent_task_max = input.concurrentTaskMax ?? input.concurrent_task_max;
    if (input.approvalModeDefault || input.approval_mode_default) patch.approval_mode_default = input.approvalModeDefault || input.approval_mode_default;
    return upsertBudget(db, userId, patch);
  }, { destructive: true, note: "Update my budget defaults (daily/monthly cap, concurrent max, default approval mode)" });

  register("browser-agent", "budget_can_start", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, ...canStartAnother(db, userId) };
  }, { note: "Check whether a new task would fit under my concurrent cap" });
}
