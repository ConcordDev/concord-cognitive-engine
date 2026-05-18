// server/domains/tasks-ai.js
//
// Tasks lens Sprint B — AI surface. 8 marquee features mirroring
// 2026 rivals: compose plan (Asana AI Studio parity), break-down
// epic (Rovo / Linear Asks), auto-prioritize backlog (Linear Agent),
// standup generator (Notion Custom Agents), triage intelligence
// (Linear flagship), voice-to-task (Todoist Ramble), tone polish,
// semantic search across all my projects.
//
// All deterministic-fallback envelope shapes so the surface keeps
// working when Ollama is offline. Run ledger captures every
// invocation (task_ai_runs) for provenance + future learning.

import {
  withTimeout, stripFences, extractJsonArray, extractJsonObject,
  recordAiRun, heuristicPriorityScore, plainText,
} from "../lib/tasks/ai-helpers.js";
import {
  hasProjectRole, getTask, getProject, listTasks, createTask, updateTask,
  getLabelsForTask,
} from "../lib/tasks/persistence.js";
import { statusesAsArray } from "../lib/tasks/workflow.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerTasksAiMacros(register) {

  // ─── 1. AI compose plan — Asana AI Studio parity ────────────────
  register("tasks", "ai_compose_plan", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const goal = String(input.goal || input.prompt || "").trim();
    if (!goal) return { ok: false, reason: "goal_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    const sys = `You produce a concise project plan as JSON: { milestones: [{name, description, taskTitles: [string]}], risks: [string], totalEstimateHours: number }. Output ONLY valid JSON, no prose around it.`;
    const userMsg = `Goal: ${goal}\n\nDraft a plan with 3-6 milestones, 4-8 tasks per milestone, key risks, and a rough hour estimate.`;

    if (!llm?.chat) {
      const fallback = {
        milestones: [{ name: "Discovery", description: "Scope + spec", taskTitles: ["Research existing work", "Draft spec", "Review with stakeholders"] }],
        risks: ["Brain offline — synthesise manually."],
        totalEstimateHours: 0,
      };
      recordAiRun(db, { projectId, userId, kind: "compose_plan", prompt: goal, outputText: JSON.stringify(fallback), source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, plan: fallback, source: "fallback" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.5, maxTokens: 1500, slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const plan = extractJsonObject(raw);
      if (!plan || !Array.isArray(plan.milestones)) {
        recordAiRun(db, { projectId, userId, kind: "compose_plan", prompt: goal, outputText: raw, source: "fallback", latencyMs: Date.now() - t0 });
        return { ok: false, reason: "parse_failed", raw: raw.slice(0, 400) };
      }
      recordAiRun(db, { projectId, userId, kind: "compose_plan", prompt: goal, outputText: JSON.stringify(plan), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, plan, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Generate a project plan (milestones + tasks + risks + estimate) from a goal" });

  // ─── 2. AI break-down — epic → tasks ────────────────────────────
  register("tasks", "ai_breakdown", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const epic = getTask(db, taskId);
    if (!epic) return { ok: false, reason: "epic_not_found" };
    if (!hasProjectRole(db, epic.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    const autoCreate = input.autoCreate !== false;

    const sys = `You break an epic / story into 3-8 concrete subtasks. Output a JSON array of {title, description, estimatePoints} — each title under 80 chars, each description 1-2 sentences. Output ONLY the JSON array.`;
    const userMsg = `Parent task (${epic.task_key}): ${epic.title}\n\n${plainText(epic.description_html, 2000)}\n\nBreak this down.`;

    if (!llm?.chat) {
      return { ok: false, reason: "llm_unavailable" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.5, maxTokens: 1200, slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const arr = extractJsonArray(raw);
      if (!Array.isArray(arr) || arr.length === 0) {
        return { ok: false, reason: "parse_failed", raw: raw.slice(0, 400) };
      }
      const proposals = arr.slice(0, 10).map((x) => ({
        title: String(x.title || "").slice(0, 200),
        description: x.description ? String(x.description).slice(0, 1000) : null,
        estimate: x.estimatePoints != null ? Number(x.estimatePoints) : null,
      })).filter((p) => p.title);

      let createdIds = [];
      if (autoCreate) {
        for (const p of proposals) {
          const t = createTask(db, {
            projectId: epic.project_id,
            reporterId: userId,
            title: p.title,
            descriptionHtml: p.description ? `<p>${p.description}</p>` : null,
            parentId: epic.id,
            estimate: p.estimate,
            type: "task",
            priority: "medium",
          });
          if (t.ok) createdIds.push({ id: t.id, taskKey: t.taskKey });
        }
      }
      recordAiRun(db, { taskId: epic.id, projectId: epic.project_id, userId, kind: "breakdown", prompt: epic.title, outputText: JSON.stringify(proposals), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, proposals, created: createdIds, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { destructive: true, requiresLLM: true, note: "Break an epic into 3-8 subtasks (auto-creates by default; pass autoCreate=false to preview only)" });

  // ─── 3. Auto-prioritize backlog ─────────────────────────────────
  register("tasks", "ai_prioritize", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const tasks = listTasks(db, { projectId, limit: 200 });
    if (tasks.length === 0) return { ok: true, ranked: [], source: "empty" };
    // Hydrate labels for heuristic scoring
    const hydrated = tasks.map((t) => ({ ...t, labels: getLabelsForTask(db, t.id) }));
    const scored = hydrated.map((t) => ({
      id: t.id,
      task_key: t.task_key,
      title: t.title,
      status_id: t.status_id,
      heuristicScore: heuristicPriorityScore(t),
    }));
    scored.sort((a, b) => b.heuristicScore - a.heuristicScore);
    // Top N optionally re-ranked by LLM if available
    const llm = ctx?.llm;
    const t0 = Date.now();
    if (input.useLlm !== false && llm?.chat && scored.length > 0) {
      try {
        const top = scored.slice(0, 20);
        const sys = `You re-rank a backlog by impact-per-effort + dependency unblocking. Output a JSON array of {task_key, score, reason} sorted descending by score. Score 0-100. Output ONLY JSON.`;
        const userMsg = `Re-rank these tasks for "what to work on next":\n${top.map((t) => `${t.task_key}: ${t.title}`).join("\n")}`;
        const r = await withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
          temperature: 0.3, maxTokens: 1500, slot: "utility",
        }));
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        const arr = extractJsonArray(raw);
        if (Array.isArray(arr) && arr.length > 0) {
          const llmScores = new Map(arr.map((x) => [String(x.task_key), { score: Number(x.score) || 0, reason: String(x.reason || "") }]));
          for (const s of scored) {
            const llmEntry = llmScores.get(s.task_key);
            if (llmEntry) { s.llmScore = llmEntry.score; s.reason = llmEntry.reason; }
          }
          scored.sort((a, b) => (b.llmScore || b.heuristicScore) - (a.llmScore || a.heuristicScore));
          recordAiRun(db, { projectId, userId, kind: "prioritize", outputText: JSON.stringify(arr).slice(0, 4000), source: "llm", latencyMs: Date.now() - t0 });
          return { ok: true, ranked: scored, source: "llm" };
        }
      } catch { /* fall through to heuristic */ }
    }
    recordAiRun(db, { projectId, userId, kind: "prioritize", outputText: `heuristic n=${scored.length}`, source: "deterministic", latencyMs: Date.now() - t0 });
    return { ok: true, ranked: scored, source: "deterministic" };
  }, { requiresLLM: false, note: "Rank a project's backlog by priority+due+labels+type heuristic, optionally re-ranked by LLM" });

  // ─── 4. Standup generator ───────────────────────────────────────
  register("tasks", "ai_standup", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = input.projectId ? String(input.projectId) : null;
    if (projectId && !hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const targetUserId = String(input.userId || userId);
    const sinceTs = Math.floor(Date.now() / 1000) - (Number(input.sinceHours) || 24) * 3600;
    // Pull recent activity: history entries by user + tasks they currently own
    const histSql = projectId
      ? `SELECT h.*, t.task_key, t.title, t.project_id FROM task_history h
         INNER JOIN tasks t ON t.id = h.task_id
         WHERE h.actor_id = ? AND h.created_at >= ? AND t.project_id = ?
         ORDER BY h.created_at DESC LIMIT 100`
      : `SELECT h.*, t.task_key, t.title, t.project_id FROM task_history h
         INNER JOIN tasks t ON t.id = h.task_id
         WHERE h.actor_id = ? AND h.created_at >= ?
         ORDER BY h.created_at DESC LIMIT 100`;
    const histArgs = projectId ? [targetUserId, sinceTs, projectId] : [targetUserId, sinceTs];
    const history = db.prepare(histSql).all(...histArgs);
    const openTasks = projectId
      ? listTasks(db, { projectId, assigneeId: targetUserId, limit: 20 })
      : db.prepare(`SELECT * FROM tasks WHERE assignee_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20`).all(targetUserId);
    const llm = ctx?.llm;
    const t0 = Date.now();

    const completedKeys = new Set();
    const inProgressKeys = new Set();
    for (const h of history) {
      if (h.action === "status_changed" && /done|completed/i.test(h.after_value || "")) completedKeys.add(h.task_key);
      else if (h.action === "status_changed" && /progress/i.test(h.after_value || "")) inProgressKeys.add(h.task_key);
    }

    if (!llm?.chat) {
      const out = `Standup (last ${Number(input.sinceHours) || 24}h)\n\n` +
        `Done: ${[...completedKeys].join(", ") || "—"}\n` +
        `In progress: ${[...inProgressKeys].join(", ") || "—"}\n` +
        `Open: ${openTasks.map((t) => t.task_key).join(", ") || "—"}`;
      recordAiRun(db, { projectId, userId, kind: "standup", outputText: out, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, standup: out, source: "fallback" };
    }

    const sys = `You write a one-paragraph standup. Format: "Yesterday: …. Today: …. Blocked by: …." Keep it under 80 words. No markdown. No greetings.`;
    const userMsg = `History (last ${Number(input.sinceHours) || 24}h):\n${history.map((h) => `- ${h.action} ${h.task_key} ${h.title}`).join("\n")}\n\nOpen tasks:\n${openTasks.map((t) => `- ${t.task_key}: ${t.title} [${t.status_id}]`).join("\n")}`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.4, maxTokens: 300, slot: "utility",
      }));
      const standup = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { projectId, userId, kind: "standup", outputText: standup, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, standup, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: false, note: "Generate a standup from the user's recent history + open tasks" });

  // ─── 5. Triage intelligence ─────────────────────────────────────
  // Apply project triage rules + optional LLM classifier suggesting
  // priority + labels for newly-created tasks.
  register("tasks", "ai_triage", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };

    // 1) Apply project rules
    const rules = db.prepare(`SELECT * FROM task_triage_rules WHERE project_id = ? AND active = 1`).all(task.project_id);
    const text = `${task.title} ${plainText(task.description_html, 2000)}`.toLowerCase();
    const applied = [];
    for (const rule of rules) {
      let hit = false;
      if (rule.pattern_kind === "substring" || rule.pattern_kind === "keyword") {
        hit = text.includes(rule.pattern.toLowerCase());
      } else if (rule.pattern_kind === "regex") {
        try { hit = new RegExp(rule.pattern, "i").test(text); } catch { /* skip bad regex */ }
      }
      if (!hit) continue;
      const action = (() => { try { return JSON.parse(rule.action_json || "{}"); } catch { return {}; } })();
      const patch = {};
      if (action.setPriority) patch.priority = action.setPriority;
      if (action.setAssignee) patch.assigneeId = action.setAssignee;
      if (action.setStatus) patch.statusId = action.setStatus;
      if (action.setType) patch.type = action.setType;
      if (Object.keys(patch).length > 0) updateTask(db, task.id, userId, patch);
      if (Array.isArray(action.addLabels) && action.addLabels.length > 0) {
        for (const l of action.addLabels) {
          db.prepare(`INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`).run(task.id, String(l).slice(0, 80));
        }
      }
      db.prepare(`UPDATE task_triage_rules SET hit_count = hit_count + 1 WHERE id = ?`).run(rule.id);
      applied.push({ ruleId: rule.id, name: rule.name, action });
    }

    // 2) Optional LLM classifier — suggests priority + labels not yet present
    const llm = ctx?.llm;
    let suggestion = null;
    if (llm?.chat && input.askLlm !== false) {
      const sys = `Classify the task. Output JSON: { suggestedPriority: "urgent"|"high"|"medium"|"low", suggestedLabels: [string], suggestedType: "task"|"bug"|"feature"|"epic"|"story"|"spike"|"chore", reason: string }. Output ONLY JSON.`;
      const userMsg = `Title: ${task.title}\nBody: ${plainText(task.description_html, 1500)}`;
      try {
        const r = await withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
          temperature: 0.3, maxTokens: 400, slot: "utility",
        }), 8000);
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        suggestion = extractJsonObject(raw);
      } catch { /* silent */ }
    }

    recordAiRun(db, { taskId: task.id, projectId: task.project_id, userId, kind: "triage", outputText: JSON.stringify({ applied, suggestion }), source: llm?.chat ? "llm" : "deterministic" });
    return { ok: true, appliedRules: applied, suggestion };
  }, { destructive: true, note: "Apply project triage rules to a task + optionally get LLM classifier suggestion" });

  // ─── 6. Voice-to-task — Todoist Ramble parity ───────────────────
  register("tasks", "ai_voice_to_task", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return { ok: false, reason: "transcript_required" };
    const autoCreate = input.autoCreate !== false;
    const llm = ctx?.llm;
    const t0 = Date.now();

    // Deterministic fallback: split on "and" / period — each chunk becomes a task title.
    if (!llm?.chat) {
      const chunks = transcript.split(/[.;]|\s+and\s+/i).map((s) => s.trim()).filter((s) => s.length > 4);
      const proposals = chunks.slice(0, 10).map((c) => ({ title: c.slice(0, 200) }));
      let created = [];
      if (autoCreate) {
        for (const p of proposals) {
          const t = createTask(db, { projectId, reporterId: userId, title: p.title });
          if (t.ok) created.push({ id: t.id, taskKey: t.taskKey });
        }
      }
      recordAiRun(db, { projectId, userId, kind: "voice", inputText: transcript, outputText: JSON.stringify(proposals), source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, proposals, created, source: "fallback" };
    }

    const sys = `Convert a voice transcript into 1-8 task objects. Output JSON array of { title (under 100 chars), priority ("urgent"|"high"|"medium"|"low"), estimatePoints (1-13 or null), labels (array of short strings or []) }. Output ONLY JSON. Preserve the user's intent — don't invent tasks.`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: transcript }],
        temperature: 0.3, maxTokens: 1000, slot: "utility",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const arr = extractJsonArray(raw);
      if (!Array.isArray(arr) || arr.length === 0) {
        return { ok: false, reason: "parse_failed", raw: raw.slice(0, 400) };
      }
      const proposals = arr.slice(0, 10).map((x) => ({
        title: String(x.title || "").slice(0, 200),
        priority: ["urgent","high","medium","low","none"].includes(x.priority) ? x.priority : "medium",
        estimate: x.estimatePoints != null ? Number(x.estimatePoints) : null,
        labels: Array.isArray(x.labels) ? x.labels.map((l) => String(l).slice(0, 80)).slice(0, 6) : [],
      })).filter((p) => p.title);

      let created = [];
      if (autoCreate) {
        for (const p of proposals) {
          const t = createTask(db, {
            projectId, reporterId: userId,
            title: p.title, priority: p.priority,
            estimate: p.estimate, labels: p.labels,
          });
          if (t.ok) created.push({ id: t.id, taskKey: t.taskKey });
        }
      }
      recordAiRun(db, { projectId, userId, kind: "voice", inputText: transcript, outputText: JSON.stringify(proposals), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, proposals, created, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { destructive: true, note: "Convert a voice transcript into tasks (Todoist Ramble parity)" });

  // ─── 7. Tone polish — rewrite a description ─────────────────────
  register("tasks", "ai_tone_polish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const text = String(input.text || "").trim();
    if (!text) return { ok: false, reason: "text_required" };
    const tone = String(input.tone || "clear and concise").slice(0, 80);
    const taskId = input.taskId ? String(input.taskId) : null;
    if (taskId) {
      const task = getTask(db, taskId);
      if (task && !hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    }
    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) return { ok: true, polished: text, source: "fallback" };

    const sys = `You rewrite a task description to be ${tone}. Output ONLY the rewritten text. Same approximate length. Preserve all facts.`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
        temperature: 0.5, maxTokens: Math.max(600, text.length),
        slot: "utility",
      }));
      const polished = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { taskId, userId, kind: "tone_polish", prompt: tone, inputText: text, outputText: polished, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, polished, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Rewrite a task description with a specified tone" });

  // ─── 8. Semantic search — bigram scoring across user's tasks ────
  register("tasks", "semantic_search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const query = String(input.query || "").trim();
    if (query.length < 2) return { ok: true, results: [] };
    // Inline semantic implementation — reuses bigram + TF-IDF idea
    // from docs but scoped to user's member projects.
    const memberProjects = db.prepare(`SELECT project_id FROM project_members WHERE user_id = ?`).all(userId).map((r) => r.project_id);
    if (memberProjects.length === 0) return { ok: true, results: [] };
    const placeholders = memberProjects.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT id, task_key, title, description_html, status_id, priority, project_id, updated_at
      FROM tasks WHERE project_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 1000
    `).all(...memberProjects);

    const STOP = new Set(["the","a","an","is","are","of","in","on","to","for","with","by","and","or","but","that","this","it","be","as","if","at"]);
    function tokens(s) {
      return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
    }
    function bigrams(toks) { const o = []; for (let i = 0; i < toks.length - 1; i++) o.push(`${toks[i]} ${toks[i+1]}`); return o; }
    function tf(arr) { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; }

    const qTok = tokens(query);
    const qBg = bigrams(qTok);
    const qTF = tf(qTok);
    const qBT = tf(qBg);

    const scored = [];
    for (const r of rows) {
      const text = `${r.title} ${plainText(r.description_html, 4000)}`;
      const tk = tokens(text);
      const bg = bigrams(tk);
      const dTF = tf(tk);
      const dBT = tf(bg);
      let score = 0;
      for (const [t, qf] of qTF) { const df = dTF.get(t) || 0; if (df > 0) score += qf * Math.log(1 + df); }
      for (const [b, qf] of qBT) { const df = dBT.get(b) || 0; if (df > 0) score += qf * df * 4; }
      if (score > 0) scored.push({ id: r.id, task_key: r.task_key, title: r.title, project_id: r.project_id, status_id: r.status_id, priority: r.priority, score: Math.round(score * 100) / 100 });
    }
    scored.sort((a, b) => b.score - a.score);
    return { ok: true, results: scored.slice(0, Math.min(Number(input.limit) || 25, 100)) };
  }, { note: "Semantic search across my member projects (bigram + TF-IDF)" });

  // ─── Triage rules CRUD ──────────────────────────────────────────

  register("tasks", "triage_rule_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const name = String(input.name || "").trim();
    const pattern = String(input.pattern || "").trim();
    if (!name || !pattern) return { ok: false, reason: "name_and_pattern_required" };
    const kind = ["substring","regex","keyword"].includes(input.patternKind) ? input.patternKind : "substring";
    const action = input.action && typeof input.action === "object" ? input.action : {};
    if (Object.keys(action).length === 0) return { ok: false, reason: "action_required" };
    const id = `trig:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO task_triage_rules (id, project_id, name, pattern, pattern_kind, action_json, author_id, origin, confidence, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'human', 1.0, 1, unixepoch(), unixepoch())
    `).run(id, projectId, name.slice(0, 120), pattern.slice(0, 200), kind, JSON.stringify(action), userId);
    return { ok: true, id };
  }, { destructive: true, note: "Create a project triage rule (admin+)" });

  register("tasks", "triage_rule_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT * FROM task_triage_rules WHERE project_id = ? ORDER BY active DESC, hit_count DESC`).all(projectId);
    return { ok: true, rules: rows.map((r) => ({ ...r, action: (() => { try { return JSON.parse(r.action_json); } catch { return {}; } })() })) };
  }, { note: "List triage rules for a project" });

  register("tasks", "triage_rule_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const row = db.prepare(`SELECT project_id FROM task_triage_rules WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, row.project_id, userId, "admin")) return { ok: false, reason: "forbidden" };
    db.prepare(`DELETE FROM task_triage_rules WHERE id = ?`).run(id);
    return { ok: true };
  }, { destructive: true, note: "Delete a triage rule" });

  register("tasks", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = input.projectId ? String(input.projectId) : null;
    const sql = projectId
      ? `SELECT * FROM task_ai_runs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM task_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    const args = projectId ? [userId, projectId, Math.min(Number(input.limit) || 50, 200)] : [userId, Math.min(Number(input.limit) || 50, 200)];
    return { ok: true, runs: db.prepare(sql).all(...args) };
  }, { note: "Recent AI runs (provenance trail)" });
}
