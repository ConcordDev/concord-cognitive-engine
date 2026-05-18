// server/domains/tasks-moats.js
//
// Tasks Sprint C — concord-native moats. 5 capability groups:
//   1. Project-bound agents publishable as agent_spec DTUs
//   2. Mint project as project_spec DTU + cross-lens cite + pack export
//   3. Project templates (4 seeded defaults + author + apply)
//   4. CSV importers (Linear / Jira / Asana / generic)
//   5. Roadmap / timeline computation

import { randomUUID } from "node:crypto";
import {
  hasProjectRole, getProject, createProject, createTask, getTask, listTasks, getDependencies,
} from "../lib/tasks/persistence.js";
import { withTimeout, stripFences, recordAiRun, plainText } from "../lib/tasks/ai-helpers.js";
import { importCsv } from "../lib/tasks/importers.js";
import { buildTimeline } from "../lib/tasks/timeline.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VALID_SLOTS = new Set(["conscious","subconscious","utility","repair","multimodal"]);
const VALID_CAPS = new Set(["read_tasks","read_sprint","read_history","write_task","triage","auto_assign","summarize"]);
const VALID_VIS = new Set(["private","workspace","public","published","global"]);

const SEED_TEMPLATES = [
  {
    id: "ptmpl:seed:software",
    name: "Software project",
    category: "software",
    icon: "💻",
    description: "Standard kanban + bug/feature/spike workflow + custom fields for RICE scoring.",
    template_json: {
      workflow: {
        statuses: [
          { id: "st:backlog", name: "Backlog", category: "backlog", color: "#94a3b8" },
          { id: "st:todo", name: "Todo", category: "todo", color: "#60a5fa" },
          { id: "st:in_progress", name: "In progress", category: "in_progress", color: "#fbbf24" },
          { id: "st:in_review", name: "In review", category: "in_review", color: "#a78bfa" },
          { id: "st:done", name: "Done", category: "done", color: "#22c55e" },
        ],
      },
      customFields: [
        { key: "rice", label: "RICE score", type: "number" },
        { key: "github_pr", label: "GitHub PR", type: "url" },
      ],
      seedTasks: [
        { title: "Define MVP scope", priority: "high", type: "task" },
        { title: "Set up CI/CD", priority: "medium", type: "chore" },
        { title: "Write tests for happy path", priority: "medium", type: "task" },
      ],
    },
  },
  {
    id: "ptmpl:seed:sprint",
    name: "Sprint planning",
    category: "sprint",
    icon: "🏃",
    description: "2-week cadence with story-point estimates + sprint goal.",
    template_json: {
      workflow: {
        statuses: [
          { id: "st:todo", name: "Todo", category: "todo", color: "#60a5fa" },
          { id: "st:in_progress", name: "In progress", category: "in_progress", color: "#fbbf24" },
          { id: "st:done", name: "Done", category: "done", color: "#22c55e" },
        ],
      },
      customFields: [{ key: "points", label: "Story points", type: "select", options: ["1","2","3","5","8","13"] }],
      seedTasks: [],
    },
  },
  {
    id: "ptmpl:seed:onboarding",
    name: "Employee onboarding",
    category: "onboarding",
    icon: "👋",
    description: "Standard new-hire checklist with week-1/week-2/month-1 milestones.",
    template_json: {
      workflow: {
        statuses: [
          { id: "st:todo", name: "Todo", category: "todo", color: "#60a5fa" },
          { id: "st:done", name: "Done", category: "done", color: "#22c55e" },
        ],
      },
      customFields: [{ key: "owner", label: "Buddy", type: "user" }],
      seedTasks: [
        { title: "Day 1: Workspace setup", priority: "high" },
        { title: "Week 1: Meet the team", priority: "medium" },
        { title: "Week 2: First contribution", priority: "medium" },
        { title: "Month 1: 30-day check-in", priority: "medium" },
      ],
    },
  },
  {
    id: "ptmpl:seed:launch",
    name: "Product launch",
    category: "launch",
    icon: "🚀",
    description: "Pre-launch / launch / post-launch milestones with go/no-go gates.",
    template_json: {
      workflow: {
        statuses: [
          { id: "st:backlog", name: "Backlog", category: "backlog", color: "#94a3b8" },
          { id: "st:in_progress", name: "In progress", category: "in_progress", color: "#fbbf24" },
          { id: "st:done", name: "Done", category: "done", color: "#22c55e" },
        ],
      },
      customFields: [
        { key: "gate", label: "Go/No-go", type: "select", options: ["go","no-go","pending"] },
      ],
      seedTasks: [
        { title: "Pre-launch: comms plan", priority: "high" },
        { title: "Launch day: monitoring", priority: "urgent" },
        { title: "Post-launch: retro", priority: "medium" },
      ],
    },
  },
];

function _seedTemplates(db) {
  try {
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM task_project_templates WHERE owner_id = 'system_seed'`).get().n;
    if (cnt > 0) return;
    const ins = db.prepare(`
      INSERT INTO task_project_templates (id, owner_id, name, description, category, icon, template_json, visibility, created_at, updated_at)
      VALUES (?, 'system_seed', ?, ?, ?, ?, ?, 'public', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const tx = db.transaction((rows) => {
      for (const t of rows) ins.run(t.id, t.name, t.description, t.category, t.icon, JSON.stringify(t.template_json), _now(), _now());
    });
    tx(SEED_TEMPLATES);
  } catch { /* best effort */ }
}

export default function registerTasksMoatsMacros(register) {

  // ─── Project-bound agents ───────────────────────────────────────

  register("tasks", "agent_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const name = String(input.name || "").trim();
    const systemPrompt = String(input.systemPrompt || "").trim();
    if (!name || !systemPrompt) return { ok: false, reason: "name_and_systemPrompt_required" };
    const slot = VALID_SLOTS.has(input.slot) ? input.slot : "utility";
    const caps = Array.isArray(input.capabilities) ? input.capabilities.filter((c) => VALID_CAPS.has(c)) : ["read_tasks"];
    const id = `pjagent:${randomUUID()}`;
    db.prepare(`
      INSERT INTO task_project_agents (id, project_id, owner_id, name, description, system_prompt, capabilities_json, slot, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, projectId, userId,
      name.slice(0, 120),
      input.description ? String(input.description).slice(0, 400) : null,
      systemPrompt.slice(0, 4000),
      JSON.stringify(caps), slot, _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a project-bound agent (admin+)" });

  register("tasks", "agent_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT id, owner_id, name, description, slot, dtu_id, active, invocation_count, capabilities_json, created_at, updated_at
      FROM task_project_agents WHERE project_id = ? ORDER BY updated_at DESC
    `).all(projectId);
    return { ok: true, agents: rows.map((r) => ({ ...r, capabilities: _safeJson(r.capabilities_json, []) })) };
  }, { note: "List project-bound agents" });

  register("tasks", "agent_run", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.agentId || "");
    const agent = db.prepare(`SELECT * FROM task_project_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (!agent.active) return { ok: false, reason: "inactive" };
    if (!hasProjectRole(db, agent.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    const caps = _safeJson(agent.capabilities_json, []);
    const userMsg = String(input.message || "").trim() || "What should I do next?";

    const ctxParts = [];
    if (caps.includes("read_tasks")) {
      const tasks = listTasks(db, { projectId: agent.project_id, limit: 50 });
      ctxParts.push(`# Tasks (${tasks.length})\n${tasks.slice(0, 25).map((t) => `- ${t.task_key} [${t.status_id}] [${t.priority}] ${t.title}`).join("\n")}`);
    }
    if (caps.includes("read_sprint")) {
      const sprints = db.prepare(`SELECT name, status, goal FROM task_sprints WHERE project_id = ? AND status IN ('planned','active')`).all(agent.project_id);
      if (sprints.length) ctxParts.push("# Active/planned sprints\n" + sprints.map((s) => `- ${s.name} [${s.status}] ${s.goal || ""}`).join("\n"));
    }

    if (!llm?.chat) {
      recordAiRun(db, { projectId: agent.project_id, userId, kind: "skill", outputText: "(brain offline)", source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: false, reason: "llm_unavailable" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [
          { role: "system", content: `${agent.system_prompt}\n\n--- Project context ---\n${ctxParts.join("\n\n---\n\n")}` },
          { role: "user", content: userMsg },
        ],
        temperature: 0.5, maxTokens: 1200, slot: agent.slot,
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const output = stripFences(raw).trim();
      db.prepare(`UPDATE task_project_agents SET invocation_count = invocation_count + 1, updated_at = ? WHERE id = ?`).run(_now(), agent.id);
      recordAiRun(db, { projectId: agent.project_id, userId, kind: "skill", prompt: agent.name, outputText: output, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, output, agent: { id: agent.id, name: agent.name }, capabilities: caps, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Run a project-bound agent with project context loaded per capability" });

  register("tasks", "agent_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const agent = db.prepare(`SELECT * FROM task_project_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (agent.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (agent.dtu_id) return { ok: true, dtuId: agent.dtu_id, alreadyPublished: true };
    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
      `).run(dtuId, `Agent: ${agent.name}`, userId, JSON.stringify({
        type: "agent_spec", kind: "project_bound_agent",
        name: agent.name, description: agent.description,
        system_prompt: agent.system_prompt,
        capabilities: _safeJson(agent.capabilities_json, []),
        slot: agent.slot,
        published_from_project: agent.project_id,
      }));
      db.prepare(`UPDATE task_project_agents SET dtu_id = ?, updated_at = ? WHERE id = ?`).run(dtuId, _now(), id);
      return { ok: true, dtuId };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint the agent as an agent_spec DTU (marketplace-discoverable)" });

  register("tasks", "agent_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const r = db.prepare(`DELETE FROM task_project_agents WHERE id = ? AND owner_id = ?`).run(id, userId);
    return { ok: r.changes > 0, deleted: r.changes };
  }, { destructive: true, note: "Delete a project-bound agent" });

  // ─── Project mint + cite + export ───────────────────────────────

  register("tasks", "project_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || input.id || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const proj = getProject(db, projectId);
    if (!proj) return { ok: false, reason: "not_found" };
    const existing = db.prepare(`SELECT * FROM task_project_mints WHERE project_id = ?`).get(projectId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "workspace";
    const royaltyRate = typeof input.royaltyRate === "number"
      ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const allowCitation = input.allowCitation !== false;
    const dtuId = `project_spec:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'project_spec', ?, ?, ?, unixepoch())
        `).run(dtuId, proj.name, userId, JSON.stringify({
          type: "project_spec",
          project_id: projectId,
          key: proj.key,
          visibility, royalty_rate: royaltyRate,
          allow_citation: allowCitation,
        }));
        db.prepare(`
          INSERT INTO task_project_mints (project_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, dtuId, userId, royaltyRate, visibility, allowCitation ? 1 : 0, _now());
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a project as a citable project_spec DTU (admin+)" });

  register("tasks", "project_mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || input.id || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const m = db.prepare(`SELECT * FROM task_project_mints WHERE project_id = ?`).get(projectId);
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether a project has been minted" });

  register("tasks", "project_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!projectId || !parentDtuId) return { ok: false, reason: "projectId_and_dtuId_required" };
    if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM task_project_mints WHERE project_id = ?`).get(projectId);
    if (!mint) return { ok: false, reason: "project_not_minted_yet" };
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
      db.prepare(`UPDATE task_project_mints SET citation_count = citation_count + 1 WHERE project_id = ?`).run(projectId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Project cites a cross-lens DTU (fires royalty cascade)" });

  register("tasks", "project_export_pack", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || input.id || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const proj = getProject(db, projectId);
    if (!proj) return { ok: false, reason: "not_found" };
    const tasks = listTasks(db, { projectId, limit: 1000 });
    const mint = db.prepare(`SELECT * FROM task_project_mints WHERE project_id = ?`).get(projectId);
    const workflows = db.prepare(`SELECT * FROM task_workflows WHERE project_id = ?`).all(projectId)
      .map((w) => ({ ...w, statuses: _safeJson(w.statuses_json, []), transitions: _safeJson(w.transitions_json, null) }));
    let ancestors = [];
    if (mint) {
      try { const { getAncestorChain } = await import("../economy/royalty-cascade.js"); ancestors = getAncestorChain(db, mint.dtu_id) || []; }
      catch { /* engine absent */ }
    }
    const pack = {
      spec: "concord-project-pack/v1",
      exported_at: _now(),
      exported_by: userId,
      project: {
        id: proj.id, key: proj.key, name: proj.name, description: proj.description, icon: proj.icon, color: proj.color,
      },
      workflows,
      task_count: tasks.length,
      tasks: tasks.map((t) => ({
        task_key: t.task_key, parent_id: t.parent_id, title: t.title,
        description_html: t.description_html, status_id: t.status_id,
        priority: t.priority, type: t.type, estimate: t.estimate, estimate_unit: t.estimate_unit,
        assignee_id: t.assignee_id, due_at: t.due_at, completed_at: t.completed_at,
      })),
      mint: mint ? { dtu_id: mint.dtu_id, creator_id: mint.creator_id, royalty_rate: mint.royalty_rate, visibility: mint.visibility, minted_at: mint.minted_at } : null,
      ancestry: ancestors,
    };
    return { ok: true, pack, filename: `${proj.key.toLowerCase()}.cnp.json` };
  }, { note: "Export a project as a portable pack with ancestry + royalty inheritance" });

  // ─── Templates ──────────────────────────────────────────────────

  register("tasks", "project_template_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    _seedTemplates(db);
    const sql = input.category
      ? `SELECT * FROM task_project_templates WHERE (owner_id = ? OR visibility IN ('workspace','public')) AND category = ? ORDER BY usage_count DESC, updated_at DESC LIMIT ?`
      : `SELECT * FROM task_project_templates WHERE owner_id = ? OR visibility IN ('workspace','public') ORDER BY (owner_id = ?) DESC, usage_count DESC, updated_at DESC LIMIT ?`;
    const args = input.category
      ? [userId, input.category, Math.min(Number(input.limit) || 100, 200)]
      : [userId, userId, Math.min(Number(input.limit) || 100, 200)];
    const rows = db.prepare(sql).all(...args);
    return { ok: true, templates: rows.map((r) => ({ ...r, template: _safeJson(r.template_json, {}) })) };
  }, { note: "List project templates (mine + workspace + public + seeded)" });

  register("tasks", "project_template_apply", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const templateId = String(input.id || input.templateId || "");
    const key = String(input.key || "").trim();
    const name = String(input.name || "").trim();
    if (!key || !name) return { ok: false, reason: "key_and_name_required" };
    const tmpl = db.prepare(`SELECT * FROM task_project_templates WHERE id = ?`).get(templateId);
    if (!tmpl) return { ok: false, reason: "template_not_found" };
    if (tmpl.owner_id !== userId && tmpl.owner_id !== "system_seed" && tmpl.visibility === "private") {
      return { ok: false, reason: "forbidden" };
    }
    const tmplData = _safeJson(tmpl.template_json, {});

    const project = createProject(db, {
      ownerId: userId, key, name,
      description: tmpl.description,
      icon: tmpl.icon || "📋",
    });
    if (!project.ok) return project;

    // Override workflow if template specifies one
    if (tmplData.workflow?.statuses) {
      db.prepare(`UPDATE task_workflows SET statuses_json = ?, transitions_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(tmplData.workflow.statuses),
        tmplData.workflow.transitions ? JSON.stringify(tmplData.workflow.transitions) : null,
        _now(), project.workflowId,
      );
    }
    // Add custom fields
    if (Array.isArray(tmplData.customFields)) {
      for (const cf of tmplData.customFields) {
        try {
          db.prepare(`
            INSERT INTO task_custom_fields (id, project_id, key, label, type, options_json, required, position, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(`cf:${randomUUID()}`, project.id,
            String(cf.key).slice(0, 60), String(cf.label).slice(0, 120),
            String(cf.type), cf.options ? JSON.stringify(cf.options) : null,
            cf.required ? 1 : 0, Number(cf.position) || 0, _now());
        } catch { /* skip invalid */ }
      }
    }
    // Seed tasks
    const createdTasks = [];
    if (Array.isArray(tmplData.seedTasks)) {
      for (const st of tmplData.seedTasks) {
        const t = createTask(db, {
          projectId: project.id, reporterId: userId,
          title: st.title, priority: st.priority || "medium",
          type: st.type || "task",
          descriptionHtml: st.description ? `<p>${st.description}</p>` : null,
        });
        if (t.ok) createdTasks.push(t.taskKey);
      }
    }
    db.prepare(`UPDATE task_project_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`).run(_now(), templateId);
    return { ok: true, projectId: project.id, key: project.key, seedTasks: createdTasks };
  }, { destructive: true, note: "Apply a template to create a new project (workflow + custom fields + seed tasks)" });

  register("tasks", "project_template_save", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const proj = getProject(db, projectId);
    if (!proj) return { ok: false, reason: "not_found" };
    const wf = db.prepare(`SELECT statuses_json, transitions_json FROM task_workflows WHERE id = ?`).get(proj.default_workflow_id);
    const cfs = db.prepare(`SELECT key, label, type, options_json, required, position FROM task_custom_fields WHERE project_id = ?`).all(projectId);
    const taskRows = input.includeSeedTasks
      ? db.prepare(`SELECT title, type, priority FROM tasks WHERE project_id = ? AND deleted_at IS NULL LIMIT 30`).all(projectId)
      : [];
    const id = `ptmpl:${randomUUID()}`;
    db.prepare(`
      INSERT INTO task_project_templates (id, owner_id, name, description, category, icon, template_json, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId,
      String(input.name || `${proj.name} template`).slice(0, 120),
      input.description ? String(input.description).slice(0, 400) : null,
      input.category || "custom",
      proj.icon,
      JSON.stringify({
        workflow: {
          statuses: _safeJson(wf?.statuses_json, []),
          transitions: _safeJson(wf?.transitions_json, null),
        },
        customFields: cfs.map((c) => ({ ...c, options: _safeJson(c.options_json, null), options_json: undefined })),
        seedTasks: taskRows,
      }),
      ["private","workspace","public"].includes(input.visibility) ? input.visibility : "private",
      _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Save the current project as a reusable template (admin+)" });

  // ─── Importers ──────────────────────────────────────────────────

  register("tasks", "import_csv", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
    const csv = String(input.csv || input.text || "");
    if (!csv.trim()) return { ok: false, reason: "csv_required" };
    const parsed = importCsv(csv);
    if (!parsed.ok) return parsed;
    const proj = getProject(db, projectId);
    const wf = db.prepare(`SELECT statuses_json FROM task_workflows WHERE id = ?`).get(proj.default_workflow_id);
    const validStatuses = new Set((_safeJson(wf?.statuses_json, []) || []).map((s) => s.id));
    const dryRun = !!input.dryRun;

    const created = [];
    const externalToInternal = new Map();
    if (!dryRun) {
      for (const row of parsed.rows) {
        const statusId = validStatuses.has(row.status) ? row.status : null;
        const t = createTask(db, {
          projectId, reporterId: userId,
          title: row.title,
          descriptionHtml: row.description ? `<p>${row.description}</p>` : null,
          priority: row.priority, type: row.type,
          statusId,
          assigneeId: row.assignee,
          dueAt: row.dueAt,
          estimate: row.estimate,
          labels: row.labels,
        });
        if (t.ok) {
          created.push({ id: t.id, taskKey: t.taskKey, externalKey: row.externalKey });
          if (row.externalKey) externalToInternal.set(row.externalKey, t.id);
        }
      }
      // Second pass: set parent_id where parentKey was given
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        if (!row.parentKey) continue;
        const childIid = created.find((c) => c.externalKey === row.externalKey)?.id;
        const parentIid = externalToInternal.get(row.parentKey);
        if (childIid && parentIid) {
          db.prepare(`UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?`).run(parentIid, _now(), childIid);
        }
      }
    }
    return {
      ok: true, provider: parsed.provider, dryRun,
      parsedCount: parsed.rows.length, createdCount: created.length,
      created, preview: parsed.rows.slice(0, 5),
    };
  }, { destructive: true, note: "Import a Linear/Jira/Asana/generic CSV into a project (set dryRun=true to preview)" });

  // ─── Roadmap / timeline ─────────────────────────────────────────

  register("tasks", "roadmap", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const tasks = listTasks(db, { projectId, limit: 500 });
    const deps = db.prepare(`
      SELECT d.* FROM task_dependencies d
      INNER JOIN tasks t ON t.id = d.blocker_id
      WHERE t.project_id = ?
    `).all(projectId);
    const tl = buildTimeline(tasks, deps, {
      startTs: Number(input.startTs) || Math.floor(Date.now() / 1000),
      pointHours: Number(input.pointHours) || 4,
    });
    return { ok: true, ...tl };
  }, { note: "Compute timeline + critical path (topo sort by dependency, priority-weighted)" });
}
