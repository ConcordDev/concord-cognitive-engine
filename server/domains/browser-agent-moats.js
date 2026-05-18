// server/domains/browser-agent-moats.js
//
// Browser-Agent lens Sprint C — concord-native moats. 4 capability
// groups: scheduled recurring runs, task chains, browser-agent
// templates publishable as agent_spec DTUs, and mint-as-DTU with
// cross-lens cite cascade.

import { randomUUID } from "node:crypto";
import { createTask, getTask } from "../lib/browser-agent/audit.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VALID_VIS = new Set(["private","workspace","public","published","global"]);

// ─── Cadence math (deterministic; no external dep) ──────────────

export function computeNextRun(cadenceKind, cadenceParam, fromTs = _now()) {
  if (cadenceKind === "every_n_hours") {
    const n = Math.max(1, Math.min(168, Number(cadenceParam) || 6));
    return fromTs + n * 3600;
  }
  if (cadenceKind === "daily") {
    // HH:MM
    const m = String(cadenceParam || "09:00").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return fromTs + 86400;
    const [, hh, mm] = m;
    const d = new Date(fromTs * 1000);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hh), Number(mm), 0));
    if (next.getTime() <= fromTs * 1000) next.setUTCDate(next.getUTCDate() + 1);
    return Math.floor(next.getTime() / 1000);
  }
  if (cadenceKind === "weekly") {
    // SU MO TU WE TH FR SA + optional HH:MM after comma
    const [day, time] = String(cadenceParam || "MO").split(",").map((s) => s.trim());
    const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const want = DAY[day?.toUpperCase()] ?? 1;
    const [hh = 9, mm = 0] = time ? time.split(":").map(Number) : [9, 0];
    const d = new Date(fromTs * 1000);
    const cur = d.getUTCDay();
    let off = want - cur; if (off < 0) off += 7;
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + off, hh, mm, 0));
    if (next.getTime() <= fromTs * 1000) next.setUTCDate(next.getUTCDate() + 7);
    return Math.floor(next.getTime() / 1000);
  }
  if (cadenceKind === "once_at") {
    return Math.max(fromTs, Number(cadenceParam) || fromTs);
  }
  // rrule — minimal: just treat as +24h until we wire the rrule lib
  return fromTs + 86400;
}

function _renderGoal(template, vars = {}) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

// ─── Seed templates ─────────────────────────────────────────────

const SEED_TEMPLATES = [
  {
    id: "btmpl:seed:scrape-monitor",
    name: "Scrape + monitor",
    description: "Visit a URL, extract content, detect changes since last run.",
    category: "monitoring",
    icon: "🔍",
    goal_template: "Visit {{url}}. Capture the main content as text. If this is a recurring run, compare against the prior result and report what changed.",
    default_approval_mode: "destructive_only",
    default_max_steps: 8,
    default_max_cost_cents: 25,
  },
  {
    id: "btmpl:seed:research-brief",
    name: "Research brief",
    description: "Search for a topic across 3-5 sources, synthesize a brief.",
    category: "research",
    icon: "📚",
    goal_template: "Research \"{{query}}\" — open 3-5 reputable sources, capture the key claims from each, and produce a 1-paragraph synthesis. Save the source URLs.",
    default_max_steps: 25,
    default_max_cost_cents: 75,
  },
  {
    id: "btmpl:seed:form-fill",
    name: "Form fill",
    description: "Fill out a form with provided field values; pause before submit.",
    category: "form_fill",
    icon: "📝",
    goal_template: "Open {{url}}. Fill out the form with these values: {{fields}}. Take a screenshot of the filled form. Pause for user approval before clicking Submit.",
    default_approval_mode: "destructive_only",
    default_max_steps: 12,
    default_max_cost_cents: 30,
  },
  {
    id: "btmpl:seed:content-watch",
    name: "Content watch",
    description: "Check a page weekly; alert me if specific text appears.",
    category: "monitoring",
    icon: "🔔",
    goal_template: "Visit {{url}}. Search the page for the string \"{{needle}}\". If found, report the surrounding context. If not, report 'not yet seen'.",
    default_max_steps: 6,
    default_max_cost_cents: 15,
  },
];

function _seedTemplates(db) {
  try {
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM browser_agent_templates WHERE owner_id = 'system_seed'`).get().n;
    if (cnt > 0) return;
    const ins = db.prepare(`
      INSERT INTO browser_agent_templates
        (id, owner_id, name, description, category, icon, goal_template,
         default_approval_mode, default_max_steps, default_max_cost_cents,
         visibility, created_at, updated_at)
      VALUES (?, 'system_seed', ?, ?, ?, ?, ?, ?, ?, ?, 'public', unixepoch(), unixepoch())
      ON CONFLICT(id) DO NOTHING
    `);
    const tx = db.transaction((rows) => {
      for (const t of rows) ins.run(t.id, t.name, t.description, t.category, t.icon, t.goal_template,
        t.default_approval_mode || "destructive_only", t.default_max_steps || 30, t.default_max_cost_cents || 100);
    });
    tx(SEED_TEMPLATES);
  } catch { /* best effort */ }
}

export default function registerBrowserAgentMoatsMacros(register) {

  // ─── Templates ───────────────────────────────────────────────────

  register("browser-agent", "template_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    _seedTemplates(db);
    const sql = input.category
      ? `SELECT * FROM browser_agent_templates WHERE (owner_id = ? OR visibility IN ('workspace','public')) AND category = ? ORDER BY usage_count DESC, updated_at DESC LIMIT ?`
      : `SELECT * FROM browser_agent_templates WHERE owner_id = ? OR visibility IN ('workspace','public') ORDER BY (owner_id = ?) DESC, usage_count DESC, updated_at DESC LIMIT ?`;
    const args = input.category
      ? [userId, input.category, Math.min(Number(input.limit) || 100, 200)]
      : [userId, userId, Math.min(Number(input.limit) || 100, 200)];
    return { ok: true, templates: db.prepare(sql).all(...args) };
  }, { note: "List browser-agent templates (mine + workspace + public + seeded)" });

  register("browser-agent", "template_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    const goal = String(input.goalTemplate || input.goal_template || "").trim();
    if (!name || !goal) return { ok: false, reason: "name_and_goalTemplate_required" };
    const id = `btmpl:${randomUUID()}`;
    db.prepare(`
      INSERT INTO browser_agent_templates
        (id, owner_id, name, description, category, icon, goal_template,
         default_starting_url, default_approval_mode, default_max_steps,
         default_max_cost_cents, tool_allowlist_json, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(id, userId, name.slice(0, 120),
      input.description ? String(input.description).slice(0, 600) : null,
      input.category || "custom",
      input.icon || null,
      goal.slice(0, 2000),
      input.defaultStartingUrl || null,
      ["off","destructive_only","every_step"].includes(input.defaultApprovalMode) ? input.defaultApprovalMode : "destructive_only",
      Number(input.defaultMaxSteps) || 30,
      Number(input.defaultMaxCostCents) || 100,
      input.toolAllowlist ? JSON.stringify(input.toolAllowlist) : null,
      ["private","workspace","public"].includes(input.visibility) ? input.visibility : "private");
    return { ok: true, id };
  }, { destructive: true, note: "Save a reusable browser-agent template" });

  register("browser-agent", "template_apply", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const t = db.prepare(`SELECT * FROM browser_agent_templates WHERE id = ?`).get(String(input.id || input.templateId || ""));
    if (!t) return { ok: false, reason: "not_found" };
    if (t.owner_id !== userId && t.owner_id !== "system_seed" && t.visibility === "private") return { ok: false, reason: "forbidden" };
    const goal = _renderGoal(t.goal_template, input.vars || {});
    const r = createTask(db, {
      userId,
      title: input.title || t.name,
      goal,
      startingUrl: input.startingUrl || t.default_starting_url,
      approvalMode: input.approvalMode || t.default_approval_mode,
      maxSteps: input.maxSteps || t.default_max_steps,
      maxCostCents: input.maxCostCents || t.default_max_cost_cents,
      toolAllowlist: input.toolAllowlist || _safeJson(t.tool_allowlist_json, null),
    });
    if (r.ok) {
      db.prepare(`UPDATE browser_agent_templates SET usage_count = usage_count + 1, updated_at = unixepoch() WHERE id = ?`).run(t.id);
    }
    return { ok: r.ok, reason: r.reason, taskId: r.id, templateId: t.id };
  }, { destructive: true, note: "Instantiate a template into a new browser task" });

  register("browser-agent", "template_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const t = db.prepare(`SELECT * FROM browser_agent_templates WHERE id = ?`).get(String(input.id || ""));
    if (!t) return { ok: false, reason: "not_found" };
    if (t.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (t.dtu_id) return { ok: true, dtuId: t.dtu_id, alreadyPublished: true };
    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
      `).run(dtuId, `Browser agent: ${t.name}`, userId, JSON.stringify({
        type: "agent_spec", kind: "browser_agent_template",
        name: t.name, description: t.description, category: t.category,
        goal_template: t.goal_template,
        default_starting_url: t.default_starting_url,
        default_approval_mode: t.default_approval_mode,
        default_max_steps: t.default_max_steps,
        default_max_cost_cents: t.default_max_cost_cents,
        tool_allowlist: _safeJson(t.tool_allowlist_json, null),
      }));
      db.prepare(`UPDATE browser_agent_templates SET dtu_id = ?, visibility = 'public', updated_at = unixepoch() WHERE id = ?`).run(dtuId, t.id);
      return { ok: true, dtuId };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a template as an agent_spec DTU (marketplace-discoverable)" });

  // ─── Schedules ───────────────────────────────────────────────────

  register("browser-agent", "schedule_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const title = String(input.title || "").trim();
    const goal = String(input.goal || "").trim();
    const cadenceKind = ["every_n_hours","daily","weekly","rrule","once_at"].includes(input.cadenceKind) ? input.cadenceKind : "every_n_hours";
    const cadenceParam = String(input.cadenceParam || (cadenceKind === "every_n_hours" ? "6" : "09:00"));
    if (!title || !goal) return { ok: false, reason: "title_and_goal_required" };
    const id = `bsched:${randomUUID()}`;
    const nextRun = computeNextRun(cadenceKind, cadenceParam);
    db.prepare(`
      INSERT INTO browser_task_schedules
        (id, user_id, template_id, title, goal, starting_url, approval_mode,
         max_steps, max_cost_cents, cadence_kind, cadence_param, next_run_at,
         enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    `).run(id, userId,
      input.templateId || null,
      title.slice(0, 200), goal.slice(0, 2000),
      input.startingUrl || null,
      ["off","destructive_only","every_step"].includes(input.approvalMode) ? input.approvalMode : "destructive_only",
      Number(input.maxSteps) || 30,
      input.maxCostCents != null ? Number(input.maxCostCents) : null,
      cadenceKind, cadenceParam, nextRun);
    return { ok: true, id, nextRunAt: nextRun };
  }, { destructive: true, note: "Create a recurring scheduled browser task (Devin-style 'keep doing it')" });

  register("browser-agent", "schedule_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, schedules: db.prepare(`SELECT * FROM browser_task_schedules WHERE user_id = ? ORDER BY enabled DESC, next_run_at ASC`).all(userId) };
  }, { note: "List my scheduled tasks" });

  register("browser-agent", "schedule_toggle", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const enabled = input.enabled ? 1 : 0;
    const r = db.prepare(`UPDATE browser_task_schedules SET enabled = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?`).run(enabled, String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Enable / disable a schedule" });

  register("browser-agent", "schedule_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM browser_task_schedules WHERE id = ? AND user_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a schedule" });

  register("browser-agent", "schedule_run_now", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const s = db.prepare(`SELECT * FROM browser_task_schedules WHERE id = ? AND user_id = ?`).get(String(input.id), userId);
    if (!s) return { ok: false, reason: "not_found" };
    const r = createTask(db, {
      userId,
      title: `${s.title} (${new Date().toISOString().slice(0, 16)})`,
      goal: s.goal,
      startingUrl: s.starting_url,
      approvalMode: s.approval_mode,
      maxSteps: s.max_steps,
      maxCostCents: s.max_cost_cents,
    });
    if (r.ok) {
      const next = computeNextRun(s.cadence_kind, s.cadence_param);
      db.prepare(`UPDATE browser_task_schedules SET last_run_at = unixepoch(), last_task_id = ?, run_count = run_count + 1, next_run_at = ?, updated_at = unixepoch() WHERE id = ?`).run(r.id, next, s.id);
    }
    return { ok: r.ok, reason: r.reason, taskId: r.id };
  }, { destructive: true, note: "Trigger a schedule's run immediately + bump next_run_at" });

  // ─── Chains ──────────────────────────────────────────────────────

  register("browser-agent", "chain_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = `bchain:${randomUUID()}`;
    db.prepare(`
      INSERT INTO browser_task_chains
        (id, user_id, trigger_task_id, trigger_template_id, trigger_on,
         next_template_id, next_goal_template, input_map_json, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
    `).run(id, userId,
      input.triggerTaskId || null,
      input.triggerTemplateId || null,
      ["success","failure","any"].includes(input.triggerOn) ? input.triggerOn : "success",
      input.nextTemplateId || null,
      input.nextGoalTemplate ? String(input.nextGoalTemplate).slice(0, 2000) : null,
      input.inputMap ? JSON.stringify(input.inputMap) : null);
    return { ok: true, id };
  }, { destructive: true, note: "Create a chain: when task X completes, run Y" });

  register("browser-agent", "chain_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, chains: db.prepare(`SELECT * FROM browser_task_chains WHERE user_id = ? ORDER BY enabled DESC, created_at DESC`).all(userId) };
  }, { note: "List my task chains" });

  register("browser-agent", "chain_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM browser_task_chains WHERE id = ? AND user_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a chain" });

  /**
   * Called by the orchestrator when a task transitions to a terminal
   * state. Fires any matching chains.
   */
  register("browser-agent", "chain_fire_on_complete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const completedSuccessfully = task.status === "completed";
    const triggerOn = completedSuccessfully ? ["success", "any"] : ["failure", "any"];
    const chains = db.prepare(`
      SELECT * FROM browser_task_chains
      WHERE user_id = ? AND enabled = 1
        AND (trigger_task_id = ? OR trigger_task_id IS NULL)
        AND trigger_on IN (${triggerOn.map(() => "?").join(", ")})
    `).all(userId, taskId, ...triggerOn);
    const fired = [];
    for (const c of chains) {
      const vars = {
        lastResult: task.result_summary || "",
        lastUrl: task.starting_url || "",
        lastTitle: task.title,
        lastId: task.id,
        ...(input.vars || {}),
      };
      const nextGoal = c.next_goal_template ? _renderGoal(c.next_goal_template, vars) : null;
      let r = null;
      if (c.next_template_id) {
        // Apply template
        const t = db.prepare(`SELECT * FROM browser_agent_templates WHERE id = ?`).get(c.next_template_id);
        if (t) {
          const goal = nextGoal || _renderGoal(t.goal_template, vars);
          r = createTask(db, {
            userId, title: `Chained: ${t.name}`,
            goal, startingUrl: t.default_starting_url,
            approvalMode: t.default_approval_mode,
            maxSteps: t.default_max_steps,
            maxCostCents: t.default_max_cost_cents,
          });
        }
      } else if (nextGoal) {
        r = createTask(db, {
          userId, title: `Chained: ${task.title}`, goal: nextGoal,
          approvalMode: task.approval_mode, maxSteps: task.max_steps,
        });
      }
      if (r?.ok) {
        db.prepare(`UPDATE browser_task_chains SET fire_count = fire_count + 1, last_fired_at = unixepoch() WHERE id = ?`).run(c.id);
        fired.push({ chainId: c.id, taskId: r.id });
      }
    }
    return { ok: true, fired, count: fired.length };
  }, { destructive: true, note: "Fire matching chains when a task completes (called by orchestrator)" });

  // ─── Mint + cross-lens cite ──────────────────────────────────────

  register("browser-agent", "task_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || input.id || "");
    const task = getTask(db, taskId);
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    if (!["completed","failed","cancelled","budget_exceeded"].includes(task.status)) {
      return { ok: false, reason: "task_not_finished" };
    }
    const existing = db.prepare(`SELECT * FROM browser_task_mints WHERE task_id = ?`).get(taskId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "workspace";
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const dtuId = `browser_run:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'browser_run', ?, ?, ?, unixepoch())
        `).run(dtuId, task.title, userId, JSON.stringify({
          type: "browser_run", task_id: taskId,
          goal: task.goal, status: task.status,
          total_steps: task.total_steps, total_cost_cents: task.total_cost_cents,
          result_summary: task.result_summary,
          royalty_rate: royaltyRate, visibility,
        }));
        db.prepare(`
          INSERT INTO browser_task_mints (task_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(taskId, dtuId, userId, royaltyRate, visibility, input.allowCitation === false ? 0 : 1, _now());
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a finished task as a citable browser_run DTU" });

  register("browser-agent", "task_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!taskId || !parentDtuId) return { ok: false, reason: "taskId_and_dtuId_required" };
    const task = getTask(db, taskId);
    if (!task || task.user_id !== userId) return { ok: false, reason: "not_found" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM browser_task_mints WHERE task_id = ?`).get(taskId);
    if (!mint) return { ok: false, reason: "task_not_minted_yet" };
    const parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId);
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id, parentId: parentDtu.id,
        creatorId: mint.creator_id, parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense, generation: 1,
      });
      if (!r.ok) return r;
      db.prepare(`UPDATE browser_task_mints SET citation_count = citation_count + 1 WHERE task_id = ?`).run(taskId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Task cites a cross-lens DTU (fires royalty cascade)" });

  register("browser-agent", "task_mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const m = db.prepare(`SELECT * FROM browser_task_mints WHERE task_id = ?`).get(String(input.taskId || input.id));
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether a task has been minted as a DTU" });
}
