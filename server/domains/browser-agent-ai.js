// server/domains/browser-agent-ai.js
//
// Browser-Agent lens Sprint B — AI surface. Plan-preview + voice-task-
// spec + LLM-driven step orchestrator + post-run summary + cost
// dashboard + Devin-style "if it works keep doing it" rerun.

import {
  withTimeout, stripFences, extractJsonObject, extractJsonArray,
  recordAiRun, deterministicPlan,
} from "../lib/browser-agent/ai-helpers.js";
import {
  createTask, getTask, transitionTask, recordAction, listActions,
} from "../lib/browser-agent/audit.js";
import { getBudget } from "../lib/browser-agent/budget.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`browser-task:${payload.taskId}`).emit(event, payload); } catch { /* best */ }
}

export default function registerBrowserAgentAiMacros(register) {

  // ─── 1. Plan preview before execution ──────────────────────────
  register("browser-agent", "ai_compose_plan", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    let planSteps;
    let source = "deterministic";
    let thought = null;

    if (llm?.chat) {
      const sys = `You produce a step-by-step browser-agent plan. Output a JSON array of {step (1-N), action (navigate|click|type|extract|screenshot|wait|summarize), target (selector or URL or description), expected (one sentence), ifFails (fallback strategy)}. 3-10 steps. Output ONLY the JSON array.`;
      const userMsg = `Goal: ${task.goal}\nStarting URL: ${task.starting_url || "(agent picks)"}\nMax steps allowed: ${task.max_steps}`;
      try {
        const r = await withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
          temperature: 0.4, maxTokens: 1200, slot: "subconscious",
        }), 12_000);
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        planSteps = extractJsonArray(raw);
        if (Array.isArray(planSteps) && planSteps.length > 0) {
          source = "llm";
          thought = raw.slice(0, 500);
        }
      } catch { /* fall through to deterministic */ }
    }

    if (!Array.isArray(planSteps) || planSteps.length === 0) {
      planSteps = deterministicPlan(task.goal);
    }

    // Supersede any prior pending plans
    db.prepare(`UPDATE browser_task_plans SET status = 'superseded' WHERE task_id = ? AND status = 'pending'`).run(task.id);
    // Compute next revision
    const last = db.prepare(`SELECT MAX(revision) AS r FROM browser_task_plans WHERE task_id = ?`).get(task.id);
    const revision = (last?.r || 0) + 1;
    const ins = db.prepare(`
      INSERT INTO browser_task_plans (task_id, revision, plan_json, author, status, llm_thought, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, unixepoch())
    `).run(task.id, revision, JSON.stringify(planSteps), source === "llm" ? "llm" : "hybrid", thought);

    transitionTask(db, task.id, "planning");
    recordAiRun(db, { taskId: task.id, userId, kind: "compose_plan", outputText: JSON.stringify(planSteps), source, latencyMs: Date.now() - t0 });
    _emit("browser-task:plan-ready", { taskId: task.id, planId: ins.lastInsertRowid, revision });
    return { ok: true, planId: ins.lastInsertRowid, revision, steps: planSteps, source };
  }, { destructive: true, note: "Compose an LLM step-by-step plan for a task (or deterministic fallback)" });

  register("browser-agent", "plan_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const rows = db.prepare(`SELECT * FROM browser_task_plans WHERE task_id = ? ORDER BY revision DESC`).all(task.id);
    return { ok: true, plans: rows.map((r) => ({ ...r, steps: _safeJson(r.plan_json, []) })) };
  }, { note: "List all plan revisions for a task" });

  register("browser-agent", "plan_decide", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const planId = Number(input.planId);
    const decision = input.decision;
    if (!["approved","rejected"].includes(decision)) return { ok: false, reason: "invalid_decision" };
    const plan = db.prepare(`
      SELECT p.*, t.user_id AS owner FROM browser_task_plans p
      INNER JOIN browser_tasks t ON t.id = p.task_id WHERE p.id = ?
    `).get(planId);
    if (!plan) return { ok: false, reason: "not_found" };
    if (plan.owner !== userId) return { ok: false, reason: "forbidden" };
    if (plan.status !== "pending") return { ok: false, reason: "already_decided" };
    db.prepare(`UPDATE browser_task_plans SET status = ?, approved_by = ?, approved_at = unixepoch() WHERE id = ?`).run(decision, userId, planId);
    if (decision === "approved") {
      transitionTask(db, plan.task_id, "running", { started_at: _now() });
    } else {
      transitionTask(db, plan.task_id, "cancelled", { result_summary: "Plan rejected by user" });
    }
    _emit("browser-task:plan-decided", { taskId: plan.task_id, planId, decision });
    return { ok: true, taskId: plan.task_id, decision };
  }, { destructive: true, note: "Approve or reject a pending plan" });

  // ─── 2. Voice → task spec ──────────────────────────────────────
  register("browser-agent", "ai_voice_task", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return { ok: false, reason: "transcript_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    let spec = null;
    if (llm?.chat) {
      const sys = `Convert a voice transcript into a browser-agent task spec JSON: { title (max 80 chars), goal (max 400 chars), startingUrl (or null), approvalMode ("off"|"destructive_only"|"every_step"; default destructive_only), maxSteps (3-50, default 20), maxCostCents (optional) }. Output ONLY JSON.`;
      try {
        const r = await withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: transcript }],
          temperature: 0.3, maxTokens: 500, slot: "utility",
        }), 6000);
        spec = extractJsonObject(String(r?.text || r?.content || r?.message?.content || ""));
      } catch { /* fall through */ }
    }
    if (!spec?.title || !spec?.goal) {
      spec = {
        title: transcript.slice(0, 80),
        goal: transcript.slice(0, 400),
        approvalMode: "destructive_only",
        maxSteps: 20,
      };
    }
    let created = null;
    if (input.autoCreate !== false) {
      const r = createTask(db, {
        userId,
        title: spec.title, goal: spec.goal,
        startingUrl: spec.startingUrl,
        approvalMode: spec.approvalMode,
        maxSteps: spec.maxSteps,
        maxCostCents: spec.maxCostCents,
      });
      if (r.ok) created = { id: r.id };
    }
    recordAiRun(db, { userId, kind: "voice_task", inputText: transcript, outputText: JSON.stringify(spec), source: llm?.chat ? "llm" : "fallback", latencyMs: Date.now() - t0 });
    return { ok: true, spec, created, source: llm?.chat ? "llm" : "fallback" };
  }, { destructive: true, note: "Voice transcript → browser-agent task spec (autoCreates by default)" });

  // ─── 3. Step orchestrator ──────────────────────────────────────
  // Picks the next action from the approved plan (or from the prior
  // step's result) and records it via the safety+budget-gated path.
  register("browser-agent", "ai_run_step", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    if (task.status !== "running") return { ok: false, reason: "not_running", status: task.status };

    // Most recent approved plan
    const plan = db.prepare(`
      SELECT plan_json FROM browser_task_plans
      WHERE task_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1
    `).get(task.id);
    const steps = _safeJson(plan?.plan_json, []);
    const stepIdx = task.total_steps;
    const nextSpec = steps[stepIdx] || null;

    const llm = ctx?.llm;
    const recent = listActions(db, task.id, { limit: 5 });
    const recentSummary = recent.map((a) => `[${a.step_index}] ${a.kind}${a.url ? " " + a.url.slice(0, 80) : ""} → ${a.success ? "ok" : "fail"}`).join("\n");

    if (!llm?.chat) {
      // Deterministic fallback: just record whatever the plan says next.
      if (!nextSpec) {
        transitionTask(db, task.id, "completed", { completed_at: _now(), result_summary: "Plan complete" });
        return { ok: true, completed: true };
      }
      const action = { kind: String(nextSpec.action || "llm_step"), thought: String(nextSpec.expected || "Plan step") };
      const r = recordAction(db, task.id, action);
      return { ok: r.ok, reason: r.reason, action, stepIndex: stepIdx, source: "deterministic" };
    }

    const sys = `You are the agent executing a browser-automation task. Output the next action as JSON: { kind: "navigate"|"click"|"type"|"screenshot"|"extract"|"scroll"|"wait"|"summarize"|"complete", url?, selector?, value?, element_text?, thought (one sentence), tokens (estimate of tokens used to decide) }. If the task is finished, output {"kind":"complete","thought":"..."}. Output ONLY JSON.`;
    const userMsg = `Task: ${task.title}\nGoal: ${task.goal}\nPlan step ${stepIdx + 1}: ${nextSpec ? JSON.stringify(nextSpec) : "(no plan; improvise)"}\nRecent actions:\n${recentSummary || "(none)"}`;
    const t0 = Date.now();
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.3, maxTokens: 400, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const action = extractJsonObject(raw);
      if (!action?.kind) {
        recordAiRun(db, { taskId: task.id, userId, kind: "run_step", outputText: raw, source: "fallback", latencyMs: Date.now() - t0 });
        return { ok: false, reason: "parse_failed", raw: raw.slice(0, 200) };
      }
      if (action.kind === "complete") {
        transitionTask(db, task.id, "completed", { completed_at: _now(), result_summary: action.thought || "Agent says complete" });
        recordAiRun(db, { taskId: task.id, userId, kind: "run_step", outputText: raw, source: "llm", latencyMs: Date.now() - t0 });
        return { ok: true, completed: true, action };
      }
      const rec = recordAction(db, task.id, { ...action, tokens: Number(action.tokens) || 100 });
      recordAiRun(db, { taskId: task.id, userId, kind: "run_step", outputText: raw, source: "llm", tokensOut: Number(action.tokens) || 100, latencyMs: Date.now() - t0 });
      return { ok: rec.ok, reason: rec.reason, action, stepIndex: stepIdx, recorded: rec, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { destructive: true, note: "Pick + record the next action for a running task (orchestrator step)" });

  // ─── 4. Post-run summary ───────────────────────────────────────
  register("browser-agent", "ai_summarize_run", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const actions = listActions(db, task.id, { limit: 200 });
    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) {
      const summary = `Task "${task.title}" ${task.status}: ${task.total_steps} steps, ${task.total_cost_cents}¢ spent.${actions.length > 0 ? ` Last action: ${actions[actions.length - 1].kind}.` : ""}`;
      transitionTask(db, task.id, task.status === "running" ? "completed" : task.status, { result_summary: summary, completed_at: _now() });
      recordAiRun(db, { taskId: task.id, userId, kind: "summarize", outputText: summary, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, summary, source: "fallback" };
    }
    const sys = `You summarize a browser-agent run in 2-3 sentences. Format: what was achieved, what data was captured, what (if anything) was blocked or skipped.`;
    const userMsg = `Goal: ${task.goal}\nStatus: ${task.status}\nSteps:\n${actions.slice(0, 30).map((a) => `[${a.step_index}] ${a.kind}${a.url ? ` ${a.url}` : ""}${a.thought ? `: ${a.thought}` : ""}`).join("\n")}`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.4, maxTokens: 300, slot: "utility",
      }), 8000);
      const summary = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      transitionTask(db, task.id, task.status === "running" ? "completed" : task.status, { result_summary: summary, completed_at: _now() });
      recordAiRun(db, { taskId: task.id, userId, kind: "summarize", outputText: summary, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, summary, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { destructive: true, note: "Post-run 2-3 sentence summary + writes result_summary to task" });

  // ─── 5. Cost dashboard (read-only) ─────────────────────────────
  register("browser-agent", "cost_dashboard", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const days = Math.min(Math.max(1, Number(input.days) || 30), 90);
    const cutoff = _now() - days * 86400;

    const byTask = db.prepare(`
      SELECT id, title, status, total_steps, total_cost_cents, total_tokens, updated_at
      FROM browser_tasks WHERE user_id = ? AND updated_at >= ?
      ORDER BY total_cost_cents DESC LIMIT 50
    `).all(userId, cutoff);

    const byDay = db.prepare(`
      SELECT DATE(updated_at, 'unixepoch') AS day,
             COUNT(*) AS tasks,
             SUM(total_cost_cents) AS cents,
             SUM(total_steps) AS steps
      FROM browser_tasks WHERE user_id = ? AND updated_at >= ?
      GROUP BY day ORDER BY day DESC
    `).all(userId, cutoff);

    const byKind = db.prepare(`
      SELECT a.kind, COUNT(*) AS count, SUM(a.cost_cents) AS cents
      FROM browser_task_actions a
      INNER JOIN browser_tasks t ON t.id = a.task_id
      WHERE t.user_id = ? AND a.created_at >= ?
      GROUP BY a.kind ORDER BY cents DESC
    `).all(userId, cutoff);

    const totals = byTask.reduce((acc, t) => ({
      cents: acc.cents + (t.total_cost_cents || 0),
      tokens: acc.tokens + (t.total_tokens || 0),
      steps: acc.steps + (t.total_steps || 0),
      tasks: acc.tasks + 1,
    }), { cents: 0, tokens: 0, steps: 0, tasks: 0 });

    const budget = getBudget(db, userId);

    return { ok: true, days, totals, byTask, byDay, byKind, budget };
  }, { note: "Spend breakdown by task / day / action kind for the user" });

  // ─── 6. Devin-style "keep doing it" reschedule ─────────────────
  register("browser-agent", "ai_reschedule", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const src = getTask(db, String(input.taskId || ""));
    if (!src || src.user_id !== userId) return { ok: false, reason: "not_found" };
    if (!["completed","failed","cancelled","budget_exceeded"].includes(src.status)) {
      return { ok: false, reason: "task_not_finished" };
    }
    const r = createTask(db, {
      userId,
      title: `${src.title} (re-run ${new Date().toISOString().slice(5, 10)})`,
      goal: src.goal,
      startingUrl: src.starting_url,
      approvalMode: src.approval_mode,
      maxSteps: src.max_steps,
      maxCostCents: src.max_cost_cents,
      toolAllowlist: src.tool_allowlist,
      contextIsolated: !!src.context_isolated,
    });
    if (!r.ok) return r;
    recordAiRun(db, { taskId: r.id, userId, kind: "reschedule", inputText: src.id, outputText: r.id, source: "deterministic" });
    return { ok: true, id: r.id, source: src.id };
  }, { destructive: true, note: "Re-queue a finished task as a fresh new run (Devin-style 'keep doing it')" });

  // ─── 7. AI runs ledger ─────────────────────────────────────────
  register("browser-agent", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = input.taskId ? String(input.taskId) : null;
    const sql = taskId
      ? `SELECT * FROM browser_task_ai_runs WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM browser_task_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    const args = taskId ? [userId, taskId, Math.min(Number(input.limit) || 100, 500)] : [userId, Math.min(Number(input.limit) || 100, 500)];
    return { ok: true, runs: db.prepare(sql).all(...args) };
  }, { note: "Recent AI invocations (provenance trail)" });
}
