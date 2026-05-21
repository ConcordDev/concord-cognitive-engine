// server/domains/projects.js
export default function registerProjectsActions(registerLensAction) {
  registerLensAction("projects", "ganttGenerate", (ctx, artifact, _params) => { const tasks = artifact.data?.tasks || []; if (tasks.length === 0) return { ok: true, result: { message: "Add tasks with duration and dependencies." } }; let dayOffset = 0; const gantt = tasks.map(t => { const duration = parseInt(t.duration) || 5; const start = dayOffset; dayOffset += duration; return { task: t.name || t.title, startDay: start, endDay: start + duration, duration, dependencies: t.dependencies || [] }; }); return { ok: true, result: { tasks: gantt, totalDays: dayOffset, totalWeeks: Math.ceil(dayOffset / 5), criticalPath: gantt.map(t => t.task) } }; });
  registerLensAction("projects", "riskMatrix", (ctx, artifact, _params) => { const risks = artifact.data?.risks || []; if (risks.length === 0) return { ok: true, result: { message: "Add project risks with likelihood and impact." } }; const scored = risks.map(r => { const likelihood = parseFloat(r.likelihood) || 0.5; const impact = parseFloat(r.impact) || 0.5; const score = Math.round(likelihood * impact * 100); return { risk: r.name || r.description, likelihood: Math.round(likelihood * 100), impact: Math.round(impact * 100), score, severity: score >= 60 ? "critical" : score >= 30 ? "high" : score >= 15 ? "medium" : "low", mitigation: r.mitigation || "Define mitigation strategy" }; }).sort((a,b) => b.score - a.score); return { ok: true, result: { risks: scored, critical: scored.filter(r => r.severity === "critical").length, total: scored.length, topRisk: scored[0]?.risk } }; });
  registerLensAction("projects", "burndownCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const totalPoints = parseInt(data.totalPoints) || 100; const sprintDays = parseInt(data.sprintDays) || 10; const completedPerDay = data.dailyCompleted || []; const idealRate = totalPoints / sprintDays; const actual = completedPerDay.reduce((s,v) => s + (parseInt(v) || 0), 0); const remaining = totalPoints - actual; const daysElapsed = completedPerDay.length; const velocity = daysElapsed > 0 ? actual / daysElapsed : 0; const projectedFinish = velocity > 0 ? Math.ceil(remaining / velocity) : Infinity; return { ok: true, result: { totalPoints, completed: actual, remaining, daysElapsed, idealBurnRate: Math.round(idealRate * 10) / 10, actualVelocity: Math.round(velocity * 10) / 10, projectedDaysToFinish: projectedFinish, onTrack: actual >= idealRate * daysElapsed * 0.9, status: actual >= idealRate * daysElapsed ? "ahead" : actual >= idealRate * daysElapsed * 0.8 ? "on-track" : "behind" } }; });
  registerLensAction("projects", "stakeholderMap", (ctx, artifact, _params) => { const stakeholders = artifact.data?.stakeholders || []; if (stakeholders.length === 0) return { ok: true, result: { message: "Add stakeholders with power and interest levels." } }; const mapped = stakeholders.map(s => { const power = parseFloat(s.power) || 50; const interest = parseFloat(s.interest) || 50; const quadrant = power >= 50 && interest >= 50 ? "manage-closely" : power >= 50 ? "keep-satisfied" : interest >= 50 ? "keep-informed" : "monitor"; return { name: s.name, power, interest, quadrant, communication: quadrant === "manage-closely" ? "weekly" : quadrant === "keep-satisfied" || quadrant === "keep-informed" ? "biweekly" : "monthly" }; }); return { ok: true, result: { stakeholders: mapped, total: mapped.length, byQuadrant: { manageClosely: mapped.filter(s => s.quadrant === "manage-closely").length, keepSatisfied: mapped.filter(s => s.quadrant === "keep-satisfied").length, keepInformed: mapped.filter(s => s.quadrant === "keep-informed").length, monitor: mapped.filter(s => s.quadrant === "monitor").length } } }; });

  // ─── Linear + Asana + Jira 2026 parity — project management ─────────
  // Projects with an issue board (status workflow), cycles/sprints with
  // burndown, milestones, members and threaded comments.

  function getPjState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.projectsLens) STATE.projectsLens = {};
    const s = STATE.projectsLens;
    for (const k of ["projects", "tasks", "sprints", "members", "milestones", "comments",
      "labels", "customFields", "attachments", "activity", "views", "rules", "templates",
      "risks", "goals", "relations", "wip"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePjState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pjId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pjNow = () => new Date().toISOString();
  const pjAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pjListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pjNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pjClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const pjPick = (v, allowed, dflt) => (allowed.includes(String(v)) ? String(v) : dflt);
  const pjDay = (v) => pjClean(v, 10).slice(0, 10);
  const PJ_DAY = 86400000;

  const PJ_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"];
  const PJ_PRIORITIES = ["none", "low", "medium", "high", "urgent"];
  const PJ_PROJECT_STATUS = ["planned", "started", "paused", "completed", "canceled"];
  const PJ_HEALTH = ["on_track", "at_risk", "off_track"];
  const PJ_TYPES = ["story", "bug", "task", "epic", "chore"];
  const PJ_RELATION_KINDS = ["blocks", "blocked_by", "relates", "duplicates"];
  const PJ_RULE_TRIGGERS = ["status_changed", "task_created", "assigned", "priority_changed"];
  const PJ_RULE_ACTIONS = ["set_status", "set_priority", "set_assignee", "add_label", "set_sprint"];

  function pjProject(s, userId, projectId) {
    return (s.projects.get(userId) || []).find((p) => p.id === projectId) || null;
  }
  // Append a per-task activity entry (audit log).
  function pjLog(s, userId, taskId, action, detail) {
    pjListB(s.activity, userId).push({
      id: pjId("act"), taskId, action,
      detail: detail == null ? null : String(detail).slice(0, 200),
      at: pjNow(),
    });
  }
  // Evaluate automation rules for a project against a task event.
  function pjRunRules(s, userId, task, trigger) {
    const rules = (s.rules.get(userId) || []).filter(
      (r) => r.projectId === task.projectId && r.trigger === trigger && r.enabled);
    for (const rule of rules) {
      // condition: optional {field, equals}
      if (rule.condition && rule.condition.field) {
        if (String(task[rule.condition.field]) !== String(rule.condition.equals)) continue;
      }
      const v = rule.actionValue;
      if (rule.action === "set_status" && PJ_STATUSES.includes(v)) {
        task.status = v;
        task.completedAt = v === "done" ? (task.completedAt || pjNow()) : null;
      } else if (rule.action === "set_priority" && PJ_PRIORITIES.includes(v)) {
        task.priority = v;
      } else if (rule.action === "set_assignee") {
        if ((s.members.get(userId) || []).some((m) => m.id === v)) task.assigneeId = v;
      } else if (rule.action === "add_label" && v) {
        if (!task.labels.includes(v)) task.labels = [...task.labels, v].slice(0, 12);
      } else if (rule.action === "set_sprint") {
        if ((s.sprints.get(userId) || []).some((x) => x.id === v)) task.sprintId = v;
      }
      pjLog(s, userId, task.id, "automation", `${rule.name}: ${rule.action}`);
    }
  }

  // ── Projects ────────────────────────────────────────────────────────
  registerLensAction("projects", "project-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pjClean(params.name, 160);
    if (!name) return { ok: false, error: "project name required" };
    const project = {
      id: pjId("prj"), name,
      key: (pjClean(params.key, 6) || name.replace(/[^A-Za-z]/g, "").slice(0, 4) || "PRJ").toUpperCase(),
      description: pjClean(params.description, 1000) || null,
      color: pjClean(params.color, 16) || "indigo",
      status: pjPick(params.status, PJ_PROJECT_STATUS, "planned"),
      health: pjPick(params.health, PJ_HEALTH, "on_track"),
      leadId: null,
      startDate: pjDay(params.startDate) || null,
      targetDate: pjDay(params.targetDate) || null,
      archived: false,
      seq: 0,
      createdAt: pjNow(), updatedAt: pjNow(),
    };
    pjListB(s.projects, pjAid(ctx)).push(project);
    savePjState();
    return { ok: true, result: { project } };
  });

  registerLensAction("projects", "project-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const projects = (s.projects.get(userId) || [])
      .filter((p) => (params.includeArchived ? true : !p.archived))
      .map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "done").length;
        return {
          ...p,
          taskCount: pt.length,
          doneCount: done,
          progressPct: pt.length ? Math.round((done / pt.length) * 100) : 0,
        };
      });
    return { ok: true, result: { projects, count: projects.length } };
  });

  // Portfolio rollup — every project's health + progress at a glance.
  registerLensAction("projects", "portfolio", (ctx, _a, _params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const projects = (s.projects.get(userId) || []).map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id);
      const done = pt.filter((t) => t.status === "done").length;
      return {
        id: p.id, name: p.name, key: p.key, status: p.status, health: p.health,
        archived: p.archived, targetDate: p.targetDate,
        totalTasks: pt.length, doneTasks: done,
        progressPct: pt.length ? Math.round((done / pt.length) * 100) : 0,
        points: pt.reduce((a, t) => a + t.points, 0),
      };
    });
    const byHealth = {};
    for (const h of PJ_HEALTH) byHealth[h] = projects.filter((p) => !p.archived && p.health === h).length;
    return {
      ok: true,
      result: {
        projects,
        active: projects.filter((p) => !p.archived).length,
        byHealth,
      },
    };
  });

  registerLensAction("projects", "project-get", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const project = pjProject(s, userId, params.id);
    if (!project) return { ok: false, error: "project not found" };
    const forP = (k) => (s[k].get(userId) || []).filter((x) => x.projectId === project.id);
    return {
      ok: true,
      result: {
        project,
        members: forP("members"),
        sprints: forP("sprints"),
        milestones: forP("milestones"),
        labels: forP("labels"),
        customFields: forP("customFields"),
        views: forP("views"),
      },
    };
  });

  registerLensAction("projects", "project-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = pjProject(s, pjAid(ctx), params.id);
    if (!project) return { ok: false, error: "project not found" };
    const userId = pjAid(ctx);
    if (params.name != null) project.name = pjClean(params.name, 160) || project.name;
    if (params.description != null) project.description = pjClean(params.description, 1000) || null;
    if (params.color != null) project.color = pjClean(params.color, 16) || project.color;
    if (params.status != null) project.status = pjPick(params.status, PJ_PROJECT_STATUS, project.status);
    if (params.health != null) project.health = pjPick(params.health, PJ_HEALTH, project.health);
    if (params.startDate != null) project.startDate = pjDay(params.startDate) || null;
    if (params.targetDate != null) project.targetDate = pjDay(params.targetDate) || null;
    if (params.leadId !== undefined) {
      const l = params.leadId ? String(params.leadId) : null;
      project.leadId = (l && (s.members.get(userId) || []).some((m) => m.id === l)) ? l : null;
    }
    project.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { project } };
  });

  registerLensAction("projects", "project-archive", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = pjProject(s, pjAid(ctx), params.id);
    if (!project) return { ok: false, error: "project not found" };
    project.archived = params.archived !== false;
    project.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { id: project.id, archived: project.archived } };
  });

  registerLensAction("projects", "project-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.projects.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    for (const k of ["tasks", "sprints", "members", "milestones", "labels", "customFields",
      "views", "rules", "templates", "risks", "goals", "wip"]) {
      const list = s[k].get(userId);
      if (list) s[k].set(userId, list.filter((x) => x.projectId !== params.id));
    }
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Tasks / issues ──────────────────────────────────────────────────
  registerLensAction("projects", "task-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const project = pjProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const title = pjClean(params.title, 240);
    if (!title) return { ok: false, error: "task title required" };
    project.seq += 1;
    let assigneeId = params.assigneeId ? String(params.assigneeId) : null;
    if (assigneeId && !(s.members.get(userId) || []).some((m) => m.id === assigneeId)) assigneeId = null;
    let sprintId = params.sprintId ? String(params.sprintId) : null;
    if (sprintId && !(s.sprints.get(userId) || []).some((sp) => sp.id === sprintId)) sprintId = null;
    let milestoneId = params.milestoneId ? String(params.milestoneId) : null;
    if (milestoneId && !(s.milestones.get(userId) || []).some((m) => m.id === milestoneId)) milestoneId = null;
    let parentId = params.parentId ? String(params.parentId) : null;
    if (parentId && !(s.tasks.get(userId) || []).some((t) => t.id === parentId && t.projectId === project.id)) {
      parentId = null;
    }
    const siblings = (s.tasks.get(userId) || []).filter((t) => t.projectId === project.id);
    const task = {
      id: pjId("tsk"), projectId: project.id,
      ref: `${project.key}-${project.seq}`,
      title,
      description: pjClean(params.description, 4000) || null,
      type: pjPick(params.type, PJ_TYPES, "task"),
      status: pjPick(params.status, PJ_STATUSES, "backlog"),
      priority: pjPick(params.priority, PJ_PRIORITIES, "none"),
      assigneeId, sprintId, milestoneId, parentId,
      labels: Array.isArray(params.labels)
        ? [...new Set(params.labels.map((l) => pjClean(l, 30)).filter(Boolean))].slice(0, 12) : [],
      customFields: {},
      points: Math.max(0, Math.round(pjNum(params.points))),
      startDate: pjDay(params.startDate) || null,
      dueDate: pjDay(params.dueDate) || null,
      rank: siblings.length,
      createdAt: pjNow(), updatedAt: pjNow(), completedAt: null,
    };
    if (task.status === "done") task.completedAt = pjNow();
    pjRunRules(s, userId, task, "task_created");
    pjListB(s.tasks, userId).push(task);
    pjLog(s, userId, task.id, "created", task.ref);
    savePjState();
    return { ok: true, result: { task } };
  });

  // Shared task filter+sort used by task-list and saved views.
  function pjFilterTasks(all, f) {
    let tasks = all.slice();
    if (f.status) tasks = tasks.filter((t) => t.status === String(f.status));
    if (f.sprintId) tasks = tasks.filter((t) => t.sprintId === String(f.sprintId));
    if (f.assigneeId) tasks = tasks.filter((t) => t.assigneeId === String(f.assigneeId));
    if (f.milestoneId) tasks = tasks.filter((t) => t.milestoneId === String(f.milestoneId));
    if (f.type) tasks = tasks.filter((t) => t.type === String(f.type));
    if (f.priority) tasks = tasks.filter((t) => t.priority === String(f.priority));
    if (f.parentId) tasks = tasks.filter((t) => t.parentId === String(f.parentId));
    if (f.label) tasks = tasks.filter((t) => t.labels.includes(String(f.label)));
    if (f.query) {
      const q = String(f.query).toLowerCase();
      tasks = tasks.filter((t) => t.title.toLowerCase().includes(q)
        || (t.description || "").toLowerCase().includes(q) || t.ref.toLowerCase().includes(q));
    }
    const prRank = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
    const sort = f.sort || "created";
    tasks.sort((a, b) => {
      if (sort === "priority") return (prRank[b.priority] || 0) - (prRank[a.priority] || 0);
      if (sort === "due") return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      if (sort === "rank") return a.rank - b.rank;
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return tasks;
  }

  registerLensAction("projects", "task-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = (s.tasks.get(pjAid(ctx)) || []).filter((t) => t.projectId === String(params.projectId));
    const tasks = pjFilterTasks(all, params);
    return { ok: true, result: { tasks, count: tasks.length } };
  });

  registerLensAction("projects", "task-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    const prevStatus = task.status;
    const prevPriority = task.priority;
    const prevAssignee = task.assigneeId;
    if (params.title != null) task.title = pjClean(params.title, 240) || task.title;
    if (params.description != null) task.description = pjClean(params.description, 4000) || null;
    if (params.type != null) task.type = pjPick(params.type, PJ_TYPES, task.type);
    if (params.priority != null) task.priority = pjPick(params.priority, PJ_PRIORITIES, task.priority);
    if (params.points != null) task.points = Math.max(0, Math.round(pjNum(params.points)));
    if (params.startDate != null) task.startDate = pjDay(params.startDate) || null;
    if (params.dueDate != null) task.dueDate = pjDay(params.dueDate) || null;
    if (Array.isArray(params.labels)) {
      task.labels = [...new Set(params.labels.map((l) => pjClean(l, 30)).filter(Boolean))].slice(0, 12);
    }
    if (params.assigneeId !== undefined) {
      const a = params.assigneeId ? String(params.assigneeId) : null;
      task.assigneeId = (a && (s.members.get(userId) || []).some((m) => m.id === a)) ? a : null;
    }
    if (params.sprintId !== undefined) {
      const sp = params.sprintId ? String(params.sprintId) : null;
      task.sprintId = (sp && (s.sprints.get(userId) || []).some((x) => x.id === sp)) ? sp : null;
    }
    if (params.milestoneId !== undefined) {
      const m = params.milestoneId ? String(params.milestoneId) : null;
      task.milestoneId = (m && (s.milestones.get(userId) || []).some((x) => x.id === m)) ? m : null;
    }
    if (params.parentId !== undefined) {
      const p = params.parentId ? String(params.parentId) : null;
      task.parentId = (p && p !== task.id
        && (s.tasks.get(userId) || []).some((t) => t.id === p && t.projectId === task.projectId)) ? p : null;
    }
    if (params.status != null) {
      task.status = pjPick(params.status, PJ_STATUSES, task.status);
      task.completedAt = task.status === "done" ? (task.completedAt || pjNow()) : null;
    }
    if (prevStatus !== task.status) {
      pjLog(s, userId, task.id, "status", `${prevStatus} → ${task.status}`);
      pjRunRules(s, userId, task, "status_changed");
    }
    if (prevPriority !== task.priority) pjRunRules(s, userId, task, "priority_changed");
    if (prevAssignee !== task.assigneeId && task.assigneeId) pjRunRules(s, userId, task, "assigned");
    task.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { task } };
  });

  registerLensAction("projects", "task-move-status", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    const prev = task.status;
    task.status = pjPick(params.status, PJ_STATUSES, task.status);
    task.completedAt = task.status === "done" ? (task.completedAt || pjNow()) : null;
    task.updatedAt = pjNow();
    if (prev !== task.status) {
      pjLog(s, userId, task.id, "status", `${prev} → ${task.status}`);
      pjRunRules(s, userId, task, "status_changed");
    }
    savePjState();
    return { ok: true, result: { id: task.id, status: task.status } };
  });

  // Reorder a task within the backlog rank.
  registerLensAction("projects", "task-rank", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    const sibs = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === task.projectId)
      .sort((a, b) => a.rank - b.rank);
    const without = sibs.filter((t) => t.id !== task.id);
    let idx = Math.round(pjNum(params.toIndex, without.length));
    idx = Math.max(0, Math.min(without.length, idx));
    without.splice(idx, 0, task);
    without.forEach((t, i) => { t.rank = i; });
    savePjState();
    return { ok: true, result: { order: without.map((t) => t.id) } };
  });

  registerLensAction("projects", "task-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.tasks.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "task not found" };
    arr.splice(i, 1);
    s.comments.set(userId, (s.comments.get(userId) || []).filter((c) => c.taskId !== params.id));
    s.attachments.set(userId, (s.attachments.get(userId) || []).filter((c) => c.taskId !== params.id));
    s.activity.set(userId, (s.activity.get(userId) || []).filter((c) => c.taskId !== params.id));
    s.relations.set(userId, (s.relations.get(userId) || [])
      .filter((r) => r.fromTaskId !== params.id && r.toTaskId !== params.id));
    for (const t of s.tasks.get(userId) || []) {
      if (t.parentId === params.id) t.parentId = null;
    }
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Comments ────────────────────────────────────────────────────────
  registerLensAction("projects", "task-comment-add", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const body = pjClean(params.body, 2000);
    if (!body) return { ok: false, error: "comment body required" };
    let parentCommentId = params.parentCommentId ? String(params.parentCommentId) : null;
    if (parentCommentId && !(s.comments.get(userId) || []).some((c) => c.id === parentCommentId)) {
      parentCommentId = null;
    }
    const mentions = [...new Set((body.match(/@[\w-]+/g) || []).map((m) => m.slice(1)))].slice(0, 10);
    const comment = {
      id: pjId("cmt"), taskId: task.id, body, parentCommentId, mentions,
      author: pjClean(params.author, 60) || "Me",
      createdAt: pjNow(),
    };
    pjListB(s.comments, userId).push(comment);
    pjLog(s, userId, task.id, "comment", parentCommentId ? "replied" : "commented");
    savePjState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("projects", "task-comments", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comments = (s.comments.get(pjAid(ctx)) || [])
      .filter((c) => c.taskId === String(params.taskId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { comments, count: comments.length } };
  });

  // ── Sprints / cycles ────────────────────────────────────────────────
  registerLensAction("projects", "sprint-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 120);
    if (!name) return { ok: false, error: "sprint name required" };
    const sprint = {
      id: pjId("spr"), projectId: String(params.projectId), name,
      startDate: pjDay(params.startDate) || pjDay(pjNow()),
      endDate: pjDay(params.endDate) || new Date(Date.now() + 14 * PJ_DAY).toISOString().slice(0, 10),
      status: "active", createdAt: pjNow(),
    };
    pjListB(s.sprints, userId).push(sprint);
    savePjState();
    return { ok: true, result: { sprint } };
  });

  registerLensAction("projects", "sprint-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const sprints = (s.sprints.get(userId) || [])
      .filter((sp) => sp.projectId === String(params.projectId))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((sp) => {
        const st = tasks.filter((t) => t.sprintId === sp.id);
        return {
          ...sp,
          taskCount: st.length,
          donePoints: st.filter((t) => t.status === "done").reduce((a, t) => a + t.points, 0),
          totalPoints: st.reduce((a, t) => a + t.points, 0),
        };
      });
    return { ok: true, result: { sprints, count: sprints.length } };
  });

  registerLensAction("projects", "sprint-complete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const sprint = (s.sprints.get(userId) || []).find((sp) => sp.id === params.id);
    if (!sprint) return { ok: false, error: "sprint not found" };
    sprint.status = "completed";
    // carry unfinished tasks back to the backlog (Linear-style cycle rollover)
    let carried = 0;
    if (params.carryOver !== false) {
      for (const t of s.tasks.get(userId) || []) {
        if (t.sprintId === sprint.id && t.status !== "done") { t.sprintId = null; carried += 1; }
      }
    }
    savePjState();
    return { ok: true, result: { id: sprint.id, status: "completed", carriedOver: carried } };
  });

  registerLensAction("projects", "sprint-burndown", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const sprint = (s.sprints.get(userId) || []).find((sp) => sp.id === params.id);
    if (!sprint) return { ok: false, error: "sprint not found" };
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.sprintId === sprint.id);
    const totalPoints = tasks.reduce((a, t) => a + t.points, 0);
    const start = Date.parse(`${sprint.startDate}T00:00:00Z`);
    const end = Date.parse(`${sprint.endDate}T00:00:00Z`);
    const days = Math.max(1, Math.min(60, Math.round((end - start) / PJ_DAY)));
    const series = [];
    for (let d = 0; d <= days; d++) {
      const dayEnd = start + d * PJ_DAY + PJ_DAY;
      const burned = tasks
        .filter((t) => t.completedAt && Date.parse(t.completedAt) < dayEnd)
        .reduce((a, t) => a + t.points, 0);
      series.push({
        day: d,
        date: new Date(start + d * PJ_DAY).toISOString().slice(0, 10),
        ideal: Math.round((totalPoints * (1 - d / days)) * 10) / 10,
        remaining: totalPoints - burned,
      });
    }
    return {
      ok: true,
      result: {
        sprint: sprint.name, totalPoints,
        donePoints: tasks.filter((t) => t.status === "done").reduce((a, t) => a + t.points, 0),
        series,
      },
    };
  });

  // ── Members ─────────────────────────────────────────────────────────
  registerLensAction("projects", "member-add", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 80);
    if (!name) return { ok: false, error: "member name required" };
    const member = {
      id: pjId("mbr"), projectId: String(params.projectId), name,
      role: pjClean(params.role, 40) || "contributor",
      createdAt: pjNow(),
    };
    pjListB(s.members, userId).push(member);
    savePjState();
    return { ok: true, result: { member } };
  });

  registerLensAction("projects", "member-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const members = (s.members.get(userId) || [])
      .filter((m) => m.projectId === String(params.projectId))
      .map((m) => ({
        ...m,
        assigned: tasks.filter((t) => t.assigneeId === m.id && t.status !== "done").length,
      }));
    return { ok: true, result: { members, count: members.length } };
  });

  registerLensAction("projects", "member-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.members.get(userId) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "member not found" };
    arr.splice(i, 1);
    for (const t of s.tasks.get(userId) || []) {
      if (t.assigneeId === params.id) t.assigneeId = null;
    }
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Milestones ──────────────────────────────────────────────────────
  registerLensAction("projects", "milestone-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 120);
    if (!name) return { ok: false, error: "milestone name required" };
    const milestone = {
      id: pjId("mil"), projectId: String(params.projectId), name,
      dueDate: pjDay(params.dueDate) || null,
      status: "open", createdAt: pjNow(),
    };
    pjListB(s.milestones, userId).push(milestone);
    savePjState();
    return { ok: true, result: { milestone } };
  });

  registerLensAction("projects", "milestone-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const milestones = (s.milestones.get(userId) || [])
      .filter((m) => m.projectId === String(params.projectId))
      .map((m) => {
        const mt = tasks.filter((t) => t.milestoneId === m.id);
        return {
          ...m,
          taskCount: mt.length,
          doneCount: mt.filter((t) => t.status === "done").length,
          progressPct: mt.length ? Math.round((mt.filter((t) => t.status === "done").length / mt.length) * 100) : 0,
        };
      });
    return { ok: true, result: { milestones, count: milestones.length } };
  });

  registerLensAction("projects", "milestone-complete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const milestone = (s.milestones.get(pjAid(ctx)) || []).find((m) => m.id === params.id);
    if (!milestone) return { ok: false, error: "milestone not found" };
    milestone.status = params.reopen ? "open" : "completed";
    savePjState();
    return { ok: true, result: { id: milestone.id, status: milestone.status } };
  });

  registerLensAction("projects", "milestone-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.milestones.get(userId) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "milestone not found" };
    arr.splice(i, 1);
    for (const t of s.tasks.get(userId) || []) {
      if (t.milestoneId === params.id) t.milestoneId = null;
    }
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Board view ──────────────────────────────────────────────────────
  registerLensAction("projects", "board", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const memberMap = new Map((s.members.get(userId) || []).map((m) => [m.id, m.name]));
    let tasks = (s.tasks.get(userId) || []).filter((t) => t.projectId === String(params.projectId));
    if (params.sprintId) tasks = tasks.filter((t) => t.sprintId === String(params.sprintId));
    const columns = PJ_STATUSES.map((status) => ({
      status,
      tasks: tasks
        .filter((t) => t.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => ({ ...t, assigneeName: t.assigneeId ? (memberMap.get(t.assigneeId) || null) : null })),
    }));
    return { ok: true, result: { columns } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("projects", "project-dashboard", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const project = pjProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.projectId === project.id);
    const byStatus = {};
    for (const st of PJ_STATUSES) byStatus[st] = tasks.filter((t) => t.status === st).length;
    const byPriority = {};
    for (const pr of PJ_PRIORITIES) byPriority[pr] = tasks.filter((t) => t.priority === pr).length;
    const done = tasks.filter((t) => t.status === "done").length;
    const today = pjDay(pjNow());
    return {
      ok: true,
      result: {
        name: project.name,
        totalTasks: tasks.length,
        done,
        completionPct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        byStatus, byPriority,
        overdue: tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "done").length,
        activeSprints: (s.sprints.get(userId) || []).filter((sp) => sp.projectId === project.id && sp.status === "active").length,
        openMilestones: (s.milestones.get(userId) || []).filter((m) => m.projectId === project.id && m.status === "open").length,
        members: (s.members.get(userId) || []).filter((m) => m.projectId === project.id).length,
      },
    };
  });

  // ── Task detail — subtasks, relations, attachments, custom fields ────
  registerLensAction("projects", "task-detail", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const allTasks = s.tasks.get(userId) || [];
    const task = allTasks.find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    const children = allTasks.filter((t) => t.parentId === task.id);
    const rels = (s.relations.get(userId) || []).filter(
      (r) => r.fromTaskId === task.id || r.toTaskId === task.id);
    const refOf = (id) => allTasks.find((t) => t.id === id);
    return {
      ok: true,
      result: {
        task,
        parent: task.parentId ? (refOf(task.parentId) || null) : null,
        subtasks: children.map((c) => ({ id: c.id, ref: c.ref, title: c.title, status: c.status, points: c.points })),
        subtaskProgress: children.length
          ? Math.round((children.filter((c) => c.status === "done").length / children.length) * 100) : null,
        relations: rels.map((r) => {
          const otherId = r.fromTaskId === task.id ? r.toTaskId : r.fromTaskId;
          const other = refOf(otherId);
          const dir = r.fromTaskId === task.id ? r.kind
            : (r.kind === "blocks" ? "blocked_by" : r.kind === "blocked_by" ? "blocks" : r.kind);
          return { id: r.id, kind: dir, task: other ? { id: other.id, ref: other.ref, title: other.title, status: other.status } : null };
        }),
        attachments: (s.attachments.get(userId) || []).filter((a) => a.taskId === task.id),
        comments: (s.comments.get(userId) || []).filter((c) => c.taskId === task.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        activity: (s.activity.get(userId) || []).filter((a) => a.taskId === task.id)
          .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
      },
    };
  });

  // ── Labels ──────────────────────────────────────────────────────────
  registerLensAction("projects", "label-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 40);
    if (!name) return { ok: false, error: "label name required" };
    const label = { id: pjId("lbl"), projectId: String(params.projectId), name, color: pjClean(params.color, 16) || "zinc" };
    pjListB(s.labels, userId).push(label);
    savePjState();
    return { ok: true, result: { label } };
  });

  registerLensAction("projects", "label-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const labels = (s.labels.get(pjAid(ctx)) || []).filter((l) => l.projectId === String(params.projectId));
    return { ok: true, result: { labels, count: labels.length } };
  });

  registerLensAction("projects", "label-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const label = (s.labels.get(pjAid(ctx)) || []).find((l) => l.id === params.id);
    if (!label) return { ok: false, error: "label not found" };
    if (params.name != null) label.name = pjClean(params.name, 40) || label.name;
    if (params.color != null) label.color = pjClean(params.color, 16) || label.color;
    savePjState();
    return { ok: true, result: { label } };
  });

  registerLensAction("projects", "label-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.labels.get(pjAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "label not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Custom fields ───────────────────────────────────────────────────
  registerLensAction("projects", "custom-field-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 60);
    if (!name) return { ok: false, error: "field name required" };
    const field = {
      id: pjId("cf"), projectId: String(params.projectId), name,
      type: pjPick(params.type, ["text", "number", "select", "date"], "text"),
      options: Array.isArray(params.options)
        ? params.options.map((o) => pjClean(o, 40)).filter(Boolean).slice(0, 20) : [],
    };
    pjListB(s.customFields, userId).push(field);
    savePjState();
    return { ok: true, result: { field } };
  });

  registerLensAction("projects", "custom-field-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const fields = (s.customFields.get(pjAid(ctx)) || []).filter((f) => f.projectId === String(params.projectId));
    return { ok: true, result: { fields, count: fields.length } };
  });

  registerLensAction("projects", "custom-field-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.customFields.get(userId) || [];
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "field not found" };
    arr.splice(i, 1);
    for (const t of s.tasks.get(userId) || []) {
      if (t.customFields) delete t.customFields[params.id];
    }
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("projects", "task-set-field", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const field = (s.customFields.get(userId) || []).find((f) => f.id === params.fieldId);
    if (!field) return { ok: false, error: "custom field not found" };
    if (!task.customFields) task.customFields = {};
    if (params.value == null || params.value === "") {
      delete task.customFields[field.id];
    } else if (field.type === "number") {
      task.customFields[field.id] = pjNum(params.value);
    } else {
      task.customFields[field.id] = pjClean(params.value, 200);
    }
    task.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { taskId: task.id, customFields: task.customFields } };
  });

  // ── Relations / dependencies ────────────────────────────────────────
  registerLensAction("projects", "relation-add", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const from = tasks.find((t) => t.id === params.fromTaskId);
    const to = tasks.find((t) => t.id === params.toTaskId);
    if (!from || !to) return { ok: false, error: "both tasks must exist" };
    if (from.id === to.id) return { ok: false, error: "a task cannot relate to itself" };
    if (from.projectId !== to.projectId) return { ok: false, error: "tasks must be in the same project" };
    const kind = pjPick(params.kind, PJ_RELATION_KINDS, "relates");
    const exists = (s.relations.get(userId) || []).some(
      (r) => r.fromTaskId === from.id && r.toTaskId === to.id && r.kind === kind);
    if (exists) return { ok: false, error: "relation already exists" };
    const relation = { id: pjId("rel"), projectId: from.projectId, fromTaskId: from.id, toTaskId: to.id, kind };
    pjListB(s.relations, userId).push(relation);
    pjLog(s, userId, from.id, "relation", `${kind} ${to.ref}`);
    savePjState();
    return { ok: true, result: { relation } };
  });

  registerLensAction("projects", "relation-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rels = (s.relations.get(pjAid(ctx)) || [])
      .filter((r) => r.fromTaskId === String(params.taskId) || r.toTaskId === String(params.taskId));
    return { ok: true, result: { relations: rels, count: rels.length } };
  });

  registerLensAction("projects", "relation-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.relations.get(pjAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "relation not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Attachments ─────────────────────────────────────────────────────
  registerLensAction("projects", "attachment-add", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const url = pjClean(params.url, 600);
    if (!/^https?:\/\//.test(url)) return { ok: false, error: "url must be http(s)" };
    const attachment = {
      id: pjId("att"), taskId: task.id, url,
      name: pjClean(params.name, 120) || url.slice(0, 60),
      createdAt: pjNow(),
    };
    pjListB(s.attachments, userId).push(attachment);
    pjLog(s, userId, task.id, "attachment", attachment.name);
    savePjState();
    return { ok: true, result: { attachment } };
  });

  registerLensAction("projects", "attachment-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const attachments = (s.attachments.get(pjAid(ctx)) || []).filter((a) => a.taskId === String(params.taskId));
    return { ok: true, result: { attachments, count: attachments.length } };
  });

  registerLensAction("projects", "attachment-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.attachments.get(pjAid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "attachment not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Activity log ────────────────────────────────────────────────────
  registerLensAction("projects", "activity-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const activity = (s.activity.get(pjAid(ctx)) || [])
      .filter((a) => a.taskId === String(params.taskId))
      .sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { activity, count: activity.length } };
  });

  // ── Saved views ─────────────────────────────────────────────────────
  registerLensAction("projects", "view-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 80);
    if (!name) return { ok: false, error: "view name required" };
    const f = params.filters || {};
    const view = {
      id: pjId("vw"), projectId: String(params.projectId), name,
      filters: {
        status: f.status ? String(f.status) : null,
        assigneeId: f.assigneeId ? String(f.assigneeId) : null,
        type: f.type ? String(f.type) : null,
        priority: f.priority ? String(f.priority) : null,
        label: f.label ? String(f.label) : null,
        sprintId: f.sprintId ? String(f.sprintId) : null,
        query: f.query ? pjClean(f.query, 120) : null,
        sort: f.sort ? String(f.sort) : "created",
      },
      createdAt: pjNow(),
    };
    pjListB(s.views, userId).push(view);
    savePjState();
    return { ok: true, result: { view } };
  });

  registerLensAction("projects", "view-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const views = (s.views.get(pjAid(ctx)) || []).filter((v) => v.projectId === String(params.projectId));
    return { ok: true, result: { views, count: views.length } };
  });

  registerLensAction("projects", "view-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.views.get(pjAid(ctx)) || [];
    const i = arr.findIndex((v) => v.id === params.id);
    if (i < 0) return { ok: false, error: "view not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("projects", "view-run", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const view = (s.views.get(userId) || []).find((v) => v.id === params.id);
    if (!view) return { ok: false, error: "view not found" };
    const all = (s.tasks.get(userId) || []).filter((t) => t.projectId === view.projectId);
    const f = {};
    for (const [k, val] of Object.entries(view.filters)) if (val) f[k] = val;
    const tasks = pjFilterTasks(all, f);
    return { ok: true, result: { view: view.name, tasks, count: tasks.length } };
  });

  // ── Automation rules ────────────────────────────────────────────────
  registerLensAction("projects", "rule-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 80);
    if (!name) return { ok: false, error: "rule name required" };
    const trigger = pjPick(params.trigger, PJ_RULE_TRIGGERS, "status_changed");
    const action = pjPick(params.action, PJ_RULE_ACTIONS, "set_priority");
    const rule = {
      id: pjId("rul"), projectId: String(params.projectId), name, trigger, action,
      actionValue: pjClean(params.actionValue, 60),
      condition: (params.condition && params.condition.field)
        ? { field: pjClean(params.condition.field, 30), equals: pjClean(params.condition.equals, 40) } : null,
      enabled: true, createdAt: pjNow(),
    };
    pjListB(s.rules, userId).push(rule);
    savePjState();
    return { ok: true, result: { rule } };
  });

  registerLensAction("projects", "rule-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rules = (s.rules.get(pjAid(ctx)) || []).filter((r) => r.projectId === String(params.projectId));
    return { ok: true, result: { rules, count: rules.length } };
  });

  registerLensAction("projects", "rule-toggle", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rule = (s.rules.get(pjAid(ctx)) || []).find((r) => r.id === params.id);
    if (!rule) return { ok: false, error: "rule not found" };
    rule.enabled = params.enabled !== false;
    savePjState();
    return { ok: true, result: { id: rule.id, enabled: rule.enabled } };
  });

  registerLensAction("projects", "rule-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.rules.get(pjAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "rule not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Templates ───────────────────────────────────────────────────────
  registerLensAction("projects", "template-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 80);
    if (!name) return { ok: false, error: "template name required" };
    const d = params.taskDefaults || {};
    const template = {
      id: pjId("tpl"), projectId: String(params.projectId), name,
      taskDefaults: {
        title: pjClean(d.title, 240) || name,
        type: pjPick(d.type, PJ_TYPES, "task"),
        priority: pjPick(d.priority, PJ_PRIORITIES, "none"),
        points: Math.max(0, Math.round(pjNum(d.points))),
        description: pjClean(d.description, 4000) || null,
      },
      subtasks: Array.isArray(params.subtasks)
        ? params.subtasks.map((x) => pjClean(x, 240)).filter(Boolean).slice(0, 30) : [],
      createdAt: pjNow(),
    };
    pjListB(s.templates, userId).push(template);
    savePjState();
    return { ok: true, result: { template } };
  });

  registerLensAction("projects", "template-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const templates = (s.templates.get(pjAid(ctx)) || []).filter((t) => t.projectId === String(params.projectId));
    return { ok: true, result: { templates, count: templates.length } };
  });

  registerLensAction("projects", "template-apply", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const template = (s.templates.get(userId) || []).find((t) => t.id === params.id);
    if (!template) return { ok: false, error: "template not found" };
    const project = pjProject(s, userId, template.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const mkTask = (over) => {
      project.seq += 1;
      const t = {
        id: pjId("tsk"), projectId: project.id, ref: `${project.key}-${project.seq}`,
        title: "task", description: null, type: "task", status: "backlog", priority: "none",
        assigneeId: null, sprintId: null, milestoneId: null, parentId: null,
        labels: [], customFields: {}, points: 0, startDate: null, dueDate: null,
        rank: (s.tasks.get(userId) || []).filter((x) => x.projectId === project.id).length,
        createdAt: pjNow(), updatedAt: pjNow(), completedAt: null, ...over,
      };
      pjListB(s.tasks, userId).push(t);
      pjLog(s, userId, t.id, "created", `from template ${template.name}`);
      return t;
    };
    const parent = mkTask({
      title: template.taskDefaults.title, type: template.taskDefaults.type,
      priority: template.taskDefaults.priority, points: template.taskDefaults.points,
      description: template.taskDefaults.description,
    });
    const subtasks = template.subtasks.map((title) => mkTask({ title, parentId: parent.id }));
    savePjState();
    return { ok: true, result: { task: parent, subtasks } };
  });

  registerLensAction("projects", "template-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.templates.get(pjAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "template not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Bulk operations ─────────────────────────────────────────────────
  registerLensAction("projects", "task-bulk-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const ids = Array.isArray(params.ids) ? params.ids.map(String) : [];
    if (!ids.length) return { ok: false, error: "ids required" };
    const patch = params.patch || {};
    let updated = 0;
    for (const task of s.tasks.get(userId) || []) {
      if (!ids.includes(task.id)) continue;
      if (patch.status != null) {
        const prev = task.status;
        task.status = pjPick(patch.status, PJ_STATUSES, task.status);
        task.completedAt = task.status === "done" ? (task.completedAt || pjNow()) : null;
        if (prev !== task.status) pjLog(s, userId, task.id, "status", `${prev} → ${task.status}`);
      }
      if (patch.priority != null) task.priority = pjPick(patch.priority, PJ_PRIORITIES, task.priority);
      if (patch.sprintId !== undefined) {
        const sp = patch.sprintId ? String(patch.sprintId) : null;
        task.sprintId = (sp && (s.sprints.get(userId) || []).some((x) => x.id === sp)) ? sp : null;
      }
      if (patch.assigneeId !== undefined) {
        const a = patch.assigneeId ? String(patch.assigneeId) : null;
        task.assigneeId = (a && (s.members.get(userId) || []).some((m) => m.id === a)) ? a : null;
      }
      if (patch.addLabel) {
        const l = pjClean(patch.addLabel, 30);
        if (l && !task.labels.includes(l)) task.labels = [...task.labels, l].slice(0, 12);
      }
      task.updatedAt = pjNow();
      updated += 1;
    }
    savePjState();
    return { ok: true, result: { updated } };
  });

  registerLensAction("projects", "task-bulk-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const ids = new Set(Array.isArray(params.ids) ? params.ids.map(String) : []);
    if (!ids.size) return { ok: false, error: "ids required" };
    const before = (s.tasks.get(userId) || []).length;
    s.tasks.set(userId, (s.tasks.get(userId) || []).filter((t) => !ids.has(t.id)));
    s.comments.set(userId, (s.comments.get(userId) || []).filter((c) => !ids.has(c.taskId)));
    s.relations.set(userId, (s.relations.get(userId) || [])
      .filter((r) => !ids.has(r.fromTaskId) && !ids.has(r.toTaskId)));
    for (const t of s.tasks.get(userId) || []) if (ids.has(t.parentId)) t.parentId = null;
    savePjState();
    return { ok: true, result: { deleted: before - (s.tasks.get(userId) || []).length } };
  });

  // ── WIP limits & swimlane board ─────────────────────────────────────
  registerLensAction("projects", "wip-set", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const status = pjPick(params.status, PJ_STATUSES, null);
    if (!status) return { ok: false, error: "valid status required" };
    const limit = Math.max(0, Math.round(pjNum(params.limit)));
    const arr = pjListB(s.wip, userId);
    const existing = arr.find((w) => w.projectId === params.projectId && w.status === status);
    if (existing) existing.limit = limit;
    else arr.push({ projectId: String(params.projectId), status, limit });
    savePjState();
    return { ok: true, result: { status, limit } };
  });

  registerLensAction("projects", "wip-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const limits = (s.wip.get(pjAid(ctx)) || []).filter((w) => w.projectId === String(params.projectId));
    return { ok: true, result: { limits } };
  });

  registerLensAction("projects", "board-swimlanes", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const groupBy = pjPick(params.groupBy, ["assignee", "epic", "priority", "type"], "assignee");
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.projectId === String(params.projectId));
    const memberMap = new Map((s.members.get(userId) || []).map((m) => [m.id, m.name]));
    const keyOf = (t) => {
      if (groupBy === "assignee") return t.assigneeId || "_unassigned";
      if (groupBy === "epic") return t.parentId || "_none";
      if (groupBy === "priority") return t.priority;
      return t.type;
    };
    const labelOf = (key) => {
      if (key === "_unassigned") return "Unassigned";
      if (key === "_none") return "No epic";
      if (groupBy === "assignee") return memberMap.get(key) || key;
      if (groupBy === "epic") return tasks.find((t) => t.id === key)?.title || key;
      return key;
    };
    const keys = [...new Set(tasks.map(keyOf))];
    const swimlanes = keys.map((key) => ({
      key, label: labelOf(key),
      columns: PJ_STATUSES.map((status) => ({
        status,
        tasks: tasks.filter((t) => keyOf(t) === key && t.status === status),
      })),
    }));
    return { ok: true, result: { groupBy, swimlanes } };
  });

  // ── Reporting ───────────────────────────────────────────────────────
  registerLensAction("projects", "report-velocity", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.projectId === String(params.projectId));
    const sprints = (s.sprints.get(userId) || [])
      .filter((sp) => sp.projectId === String(params.projectId))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const series = sprints.map((sp) => {
      const st = tasks.filter((t) => t.sprintId === sp.id);
      return {
        sprint: sp.name, status: sp.status,
        committed: st.reduce((a, t) => a + t.points, 0),
        completed: st.filter((t) => t.status === "done").reduce((a, t) => a + t.points, 0),
      };
    });
    const done = series.filter((x) => x.status === "completed");
    const avgVelocity = done.length
      ? Math.round((done.reduce((a, x) => a + x.completed, 0) / done.length) * 10) / 10 : 0;
    return { ok: true, result: { series, avgVelocity, completedSprints: done.length } };
  });

  registerLensAction("projects", "report-flow", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(7, Math.min(120, Math.round(pjNum(params.days, 30))));
    const tasks = (s.tasks.get(pjAid(ctx)) || []).filter((t) => t.projectId === String(params.projectId));
    const series = [];
    for (let d = days - 1; d >= 0; d--) {
      const cutoff = new Date(Date.now() - d * PJ_DAY).toISOString();
      const created = tasks.filter((t) => t.createdAt <= cutoff).length;
      const completed = tasks.filter((t) => t.completedAt && t.completedAt <= cutoff).length;
      series.push({
        date: cutoff.slice(0, 10), created, completed, open: created - completed,
      });
    }
    return { ok: true, result: { series } };
  });

  registerLensAction("projects", "report-cycle-time", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === String(params.projectId) && t.completedAt);
    const activity = s.activity.get(userId) || [];
    const rows = tasks.map((t) => {
      const startEntry = activity
        .filter((a) => a.taskId === t.id && a.action === "status" && /→ in_progress/.test(a.detail || ""))
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      const cycleStart = startEntry ? startEntry.at : t.createdAt;
      const cycleDays = Math.max(0, (Date.parse(t.completedAt) - Date.parse(cycleStart)) / PJ_DAY);
      const leadDays = Math.max(0, (Date.parse(t.completedAt) - Date.parse(t.createdAt)) / PJ_DAY);
      return { ref: t.ref, cycleDays: Math.round(cycleDays * 10) / 10, leadDays: Math.round(leadDays * 10) / 10 };
    });
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
    return {
      ok: true,
      result: {
        completedTasks: rows.length,
        avgCycleDays: avg(rows.map((r) => r.cycleDays)),
        avgLeadDays: avg(rows.map((r) => r.leadDays)),
        rows: rows.slice(-30),
      },
    };
  });

  registerLensAction("projects", "report-forecast", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.projectId === String(params.projectId));
    const remainingPoints = tasks.filter((t) => t.status !== "done").reduce((a, t) => a + t.points, 0);
    const sprints = (s.sprints.get(userId) || [])
      .filter((sp) => sp.projectId === String(params.projectId) && sp.status === "completed");
    const velocities = sprints.map((sp) =>
      tasks.filter((t) => t.sprintId === sp.id && t.status === "done").reduce((a, t) => a + t.points, 0));
    const avgVelocity = velocities.length
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;
    return {
      ok: true,
      result: {
        remainingPoints,
        avgVelocity: Math.round(avgVelocity * 10) / 10,
        projectedSprints: avgVelocity > 0 ? Math.ceil(remainingPoints / avgVelocity) : null,
        basis: velocities.length,
      },
    };
  });

  // ── Risk register ───────────────────────────────────────────────────
  registerLensAction("projects", "risk-add", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 200);
    if (!name) return { ok: false, error: "risk name required" };
    const likelihood = Math.max(1, Math.min(5, Math.round(pjNum(params.likelihood, 3))));
    const impact = Math.max(1, Math.min(5, Math.round(pjNum(params.impact, 3))));
    const score = likelihood * impact;
    const risk = {
      id: pjId("rsk"), projectId: String(params.projectId), name, likelihood, impact, score,
      severity: score >= 15 ? "critical" : score >= 9 ? "high" : score >= 4 ? "medium" : "low",
      mitigation: pjClean(params.mitigation, 600) || null,
      createdAt: pjNow(),
    };
    pjListB(s.risks, userId).push(risk);
    savePjState();
    return { ok: true, result: { risk } };
  });

  registerLensAction("projects", "risk-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const risks = (s.risks.get(pjAid(ctx)) || [])
      .filter((r) => r.projectId === String(params.projectId))
      .sort((a, b) => b.score - a.score);
    return {
      ok: true,
      result: { risks, count: risks.length, critical: risks.filter((r) => r.severity === "critical").length },
    };
  });

  registerLensAction("projects", "risk-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.risks.get(pjAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "risk not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Goals / OKRs ────────────────────────────────────────────────────
  registerLensAction("projects", "goal-create", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const name = pjClean(params.name, 200);
    if (!name) return { ok: false, error: "goal name required" };
    const goal = {
      id: pjId("goal"), projectId: String(params.projectId), name,
      metric: pjClean(params.metric, 60) || "progress",
      target: pjNum(params.target, 100),
      current: pjNum(params.current, 0),
      createdAt: pjNow(),
    };
    pjListB(s.goals, userId).push(goal);
    savePjState();
    return { ok: true, result: { goal } };
  });

  registerLensAction("projects", "goal-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const goals = (s.goals.get(pjAid(ctx)) || [])
      .filter((g) => g.projectId === String(params.projectId))
      .map((g) => ({
        ...g,
        progressPct: g.target > 0 ? Math.round((g.current / g.target) * 100) : 0,
      }));
    return { ok: true, result: { goals, count: goals.length } };
  });

  registerLensAction("projects", "goal-update-progress", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const goal = (s.goals.get(pjAid(ctx)) || []).find((g) => g.id === params.id);
    if (!goal) return { ok: false, error: "goal not found" };
    if (params.current != null) goal.current = pjNum(params.current, goal.current);
    if (params.target != null) goal.target = pjNum(params.target, goal.target);
    savePjState();
    return {
      ok: true,
      result: { goal: { ...goal, progressPct: goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0 } },
    };
  });

  registerLensAction("projects", "goal-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.goals.get(pjAid(ctx)) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "goal not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Timeline / Gantt ────────────────────────────────────────────────
  registerLensAction("projects", "timeline", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    if (!pjProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const tasks = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === String(params.projectId) && (t.startDate || t.dueDate))
      .map((t) => ({
        id: t.id, ref: t.ref, title: t.title, status: t.status, type: t.type,
        start: t.startDate || t.dueDate, end: t.dueDate || t.startDate,
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const milestones = (s.milestones.get(userId) || [])
      .filter((m) => m.projectId === String(params.projectId) && m.dueDate)
      .map((m) => ({ id: m.id, name: m.name, date: m.dueDate, status: m.status }));
    return { ok: true, result: { tasks, milestones } };
  });

  // ════════════════════════════════════════════════════════════════════
  //  2026 PARITY BACKLOG — Linear / Asana feature gaps
  // ════════════════════════════════════════════════════════════════════
  // Extra per-user state maps for the backlog features.
  function getPjExtra() {
    const s = getPjState();
    if (!s) return null;
    for (const k of ["notifications", "integrations", "presence", "triage", "slaPolicies"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  // Push a notification onto a user's inbox (deduped lightly by kind+entity).
  function pjNotify(s, userId, n) {
    const inbox = pjListB(s.notifications, userId);
    inbox.push({
      id: pjId("ntf"), kind: n.kind, title: pjClean(n.title, 200),
      detail: n.detail == null ? null : String(n.detail).slice(0, 300),
      projectId: n.projectId || null, taskId: n.taskId || null,
      read: false, createdAt: pjNow(),
    });
    // Keep the inbox bounded.
    if (inbox.length > 500) inbox.splice(0, inbox.length - 500);
  }

  // ── [M] Real-time multiplayer sync — live cursors + presence ─────────
  registerLensAction("projects", "presence-ping", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const projectId = String(params.projectId || "");
    if (!pjProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const arr = pjListB(s.presence, projectId);
    const collaborator = pjClean(params.collaborator, 60) || userId;
    let row = arr.find((p) => p.collaborator === collaborator);
    if (!row) { row = { id: pjId("prs"), collaborator }; arr.push(row); }
    row.cursorX = Math.max(0, Math.min(100, pjNum(params.cursorX, row.cursorX || 0)));
    row.cursorY = Math.max(0, Math.min(100, pjNum(params.cursorY, row.cursorY || 0)));
    row.viewing = pjClean(params.viewing, 40) || row.viewing || "board";
    row.editingTaskId = params.editingTaskId ? String(params.editingTaskId) : null;
    row.color = pjClean(params.color, 16) || row.color || "indigo";
    row.lastSeen = pjNow();
    savePjState();
    return { ok: true, result: { collaborator, lastSeen: row.lastSeen } };
  });

  registerLensAction("projects", "presence-list", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projectId = String(params.projectId || "");
    const cutoff = Date.now() - 45_000; // collaborators idle >45s drop off
    const arr = (s.presence.get(projectId) || []).filter((p) => Date.parse(p.lastSeen) >= cutoff);
    s.presence.set(projectId, arr);
    return { ok: true, result: { collaborators: arr, count: arr.length } };
  });

  // Lightweight change-feed: returns tasks touched since a timestamp so a
  // client can instantly reconcile without a full reload.
  registerLensAction("projects", "sync-since", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const projectId = String(params.projectId || "");
    if (!pjProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const since = pjClean(params.since, 30) || "1970-01-01T00:00:00.000Z";
    const all = (s.tasks.get(userId) || []).filter((t) => t.projectId === projectId);
    const changed = all.filter((t) => t.updatedAt > since)
      .map((t) => ({ id: t.id, ref: t.ref, title: t.title, status: t.status, updatedAt: t.updatedAt }));
    return { ok: true, result: { changed, count: changed.length, now: pjNow() } };
  });

  // ── [M] Binary file attachments ─────────────────────────────────────
  // Stores small inline binary payloads (base64 data) directly on the task,
  // distinct from the URL-only attachment-add.
  registerLensAction("projects", "attachment-upload", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const fileName = pjClean(params.fileName, 160);
    if (!fileName) return { ok: false, error: "fileName required" };
    const data = String(params.data || "");
    if (!data) return { ok: false, error: "file data required" };
    // base64 payload, optionally with a data: prefix.
    const b64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { ok: false, error: "data must be base64" };
    const bytes = Math.floor((b64.replace(/\s/g, "").length * 3) / 4);
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap per file
    if (bytes > MAX_BYTES) return { ok: false, error: "file exceeds 5 MB limit" };
    const attachment = {
      id: pjId("att"), taskId: task.id, kind: "binary",
      name: fileName, fileName,
      mimeType: pjClean(params.mimeType, 100) || "application/octet-stream",
      bytes, data: b64.replace(/\s/g, ""),
      createdAt: pjNow(),
    };
    pjListB(s.attachments, userId).push(attachment);
    pjLog(s, userId, task.id, "attachment", `uploaded ${fileName}`);
    savePjState();
    // Return without the heavy data blob.
    const { data: _d, ...meta } = attachment;
    return { ok: true, result: { attachment: meta } };
  });

  // Fetch a single binary attachment's data for download/preview.
  registerLensAction("projects", "attachment-download", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const att = (s.attachments.get(pjAid(ctx)) || []).find((a) => a.id === params.id);
    if (!att) return { ok: false, error: "attachment not found" };
    if (att.kind !== "binary") return { ok: false, error: "attachment is not a binary file" };
    return {
      ok: true,
      result: {
        id: att.id, fileName: att.fileName, mimeType: att.mimeType,
        bytes: att.bytes, data: att.data,
      },
    };
  });

  // ── [M] GitHub / Slack / CI integrations ────────────────────────────
  const PJ_INTEGRATION_KINDS = ["github", "slack", "ci"];
  registerLensAction("projects", "integration-connect", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const projectId = String(params.projectId || "");
    if (!pjProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const kind = pjPick(params.kind, PJ_INTEGRATION_KINDS, null);
    if (!kind) return { ok: false, error: "valid integration kind required" };
    const target = pjClean(params.target, 200);
    if (!target) return { ok: false, error: "target (repo / channel / pipeline) required" };
    const arr = pjListB(s.integrations, userId);
    const existing = arr.find((i) => i.projectId === projectId && i.kind === kind);
    if (existing) {
      existing.target = target;
      existing.enabled = true;
      existing.updatedAt = pjNow();
      savePjState();
      return { ok: true, result: { integration: existing } };
    }
    const integration = {
      id: pjId("itg"), projectId, kind, target,
      enabled: true, linkCount: 0, createdAt: pjNow(), updatedAt: pjNow(),
    };
    arr.push(integration);
    savePjState();
    return { ok: true, result: { integration } };
  });

  registerLensAction("projects", "integration-list", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const integrations = (s.integrations.get(pjAid(ctx)) || [])
      .filter((i) => i.projectId === String(params.projectId));
    return { ok: true, result: { integrations, count: integrations.length } };
  });

  registerLensAction("projects", "integration-toggle", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const itg = (s.integrations.get(pjAid(ctx)) || []).find((i) => i.id === params.id);
    if (!itg) return { ok: false, error: "integration not found" };
    itg.enabled = params.enabled !== false;
    itg.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { id: itg.id, enabled: itg.enabled } };
  });

  registerLensAction("projects", "integration-delete", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.integrations.get(pjAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "integration not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Link an external artifact (GitHub PR/issue, CI run, Slack thread) to a
  // task. Records the link as an attachment + activity entry, and — for CI
  // links carrying a status — can auto-advance the task status.
  registerLensAction("projects", "integration-link", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const itg = (s.integrations.get(userId) || []).find((i) => i.id === params.integrationId);
    if (!itg) return { ok: false, error: "integration not found" };
    if (!itg.enabled) return { ok: false, error: "integration is disabled" };
    if (itg.projectId !== task.projectId) return { ok: false, error: "integration belongs to a different project" };
    const url = pjClean(params.url, 600);
    if (!/^https?:\/\//.test(url)) return { ok: false, error: "url must be http(s)" };
    const label = pjClean(params.label, 160) || `${itg.kind} link`;
    const link = {
      id: pjId("att"), taskId: task.id, kind: "integration",
      integrationKind: itg.kind, name: label, url,
      ciStatus: itg.kind === "ci" ? pjPick(params.ciStatus, ["passed", "failed", "running"], null) : null,
      createdAt: pjNow(),
    };
    pjListB(s.attachments, userId).push(link);
    itg.linkCount += 1;
    pjLog(s, userId, task.id, "integration", `${itg.kind}: ${label}`);
    // CI green can auto-advance an in-review task to done.
    let autoAdvanced = false;
    if (itg.kind === "ci" && link.ciStatus === "passed" && task.status === "in_review"
        && params.autoAdvance !== false) {
      const prev = task.status;
      task.status = "done";
      task.completedAt = task.completedAt || pjNow();
      task.updatedAt = pjNow();
      autoAdvanced = true;
      pjLog(s, userId, task.id, "status", `${prev} → done (CI passed)`);
      pjRunRules(s, userId, task, "status_changed");
    }
    // Slack/GitHub links generate a posted-to-channel notification.
    if (itg.kind === "slack" || itg.kind === "github") {
      pjNotify(s, userId, {
        kind: "integration", projectId: task.projectId, taskId: task.id,
        title: `${itg.kind === "slack" ? "Posted to" : "Linked"} ${itg.target}`,
        detail: `${task.ref} — ${label}`,
      });
    }
    savePjState();
    return { ok: true, result: { link, autoAdvanced } };
  });

  // ── [S] Notification inbox ──────────────────────────────────────────
  registerLensAction("projects", "notifications-list", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    let inbox = (s.notifications.get(pjAid(ctx)) || []).slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (params.unreadOnly) inbox = inbox.filter((n) => !n.read);
    if (params.kind) inbox = inbox.filter((n) => n.kind === String(params.kind));
    const unread = (s.notifications.get(pjAid(ctx)) || []).filter((n) => !n.read).length;
    return { ok: true, result: { notifications: inbox.slice(0, 100), count: inbox.length, unread } };
  });

  registerLensAction("projects", "notification-mark-read", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const inbox = s.notifications.get(pjAid(ctx)) || [];
    if (params.all) {
      let marked = 0;
      for (const n of inbox) if (!n.read) { n.read = true; marked += 1; }
      savePjState();
      return { ok: true, result: { marked } };
    }
    const n = inbox.find((x) => x.id === params.id);
    if (!n) return { ok: false, error: "notification not found" };
    n.read = params.read !== false;
    savePjState();
    return { ok: true, result: { id: n.id, read: n.read } };
  });

  registerLensAction("projects", "notification-clear", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const inbox = s.notifications.get(userId) || [];
    if (params.id) {
      const i = inbox.findIndex((n) => n.id === params.id);
      if (i < 0) return { ok: false, error: "notification not found" };
      inbox.splice(i, 1);
      savePjState();
      return { ok: true, result: { deleted: params.id } };
    }
    const before = inbox.length;
    s.notifications.set(userId, params.readOnly ? inbox.filter((n) => !n.read) : []);
    savePjState();
    return { ok: true, result: { cleared: before - (s.notifications.get(userId) || []).length } };
  });

  // ── [S] Keyboard-driven command bar — instant navigation/search ─────
  // Resolves a typed query into navigable results: projects, tasks (by ref
  // or title) and quick "create" intents. Backs a Linear-style C-to-create
  // command palette.
  registerLensAction("projects", "command-search", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const q = pjClean(params.query, 120).toLowerCase();
    const projectId = params.projectId ? String(params.projectId) : null;
    const results = [];
    const projects = (s.projects.get(userId) || []).filter((p) => !p.archived);
    for (const p of projects) {
      if (!q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) {
        results.push({ kind: "project", id: p.id, label: p.name, sub: p.key });
      }
    }
    let tasks = s.tasks.get(userId) || [];
    if (projectId) tasks = tasks.filter((t) => t.projectId === projectId);
    for (const t of tasks) {
      if (!q || t.title.toLowerCase().includes(q) || t.ref.toLowerCase().includes(q)) {
        results.push({
          kind: "task", id: t.id, projectId: t.projectId,
          label: t.title, sub: t.ref, status: t.status, priority: t.priority,
        });
      }
      if (results.length >= 50) break;
    }
    // Command intents the palette can execute directly.
    const commands = [];
    if (q) {
      commands.push({ kind: "command", id: "create-task", label: `Create issue "${pjClean(params.query, 80)}"`, action: "task-create" });
      commands.push({ kind: "command", id: "create-project", label: `Create project "${pjClean(params.query, 80)}"`, action: "project-create" });
    }
    return { ok: true, result: { results: results.slice(0, 50), commands, count: results.length } };
  });

  // ── [M] Triage / inbox workflow ─────────────────────────────────────
  // Incoming issues land in a triage queue (status backlog + isTriage flag)
  // before being accepted into the backlog.
  registerLensAction("projects", "triage-submit", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const project = pjProject(s, userId, params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const title = pjClean(params.title, 240);
    if (!title) return { ok: false, error: "issue title required" };
    project.seq += 1;
    const task = {
      id: pjId("tsk"), projectId: project.id, ref: `${project.key}-${project.seq}`,
      title, description: pjClean(params.description, 4000) || null,
      type: pjPick(params.type, PJ_TYPES, "bug"),
      status: "backlog", priority: "none",
      assigneeId: null, sprintId: null, milestoneId: null, parentId: null,
      labels: [], customFields: {}, points: 0, startDate: null, dueDate: null,
      rank: (s.tasks.get(userId) || []).filter((t) => t.projectId === project.id).length,
      isTriage: true,
      triageSource: pjPick(params.source, ["user", "support", "integration", "form"], "user"),
      createdAt: pjNow(), updatedAt: pjNow(), completedAt: null,
    };
    pjListB(s.tasks, userId).push(task);
    pjLog(s, userId, task.id, "triage", `submitted via ${task.triageSource}`);
    pjNotify(s, userId, {
      kind: "triage", projectId: project.id, taskId: task.id,
      title: "New issue needs triage", detail: `${task.ref} — ${title}`,
    });
    savePjState();
    return { ok: true, result: { task } };
  });

  registerLensAction("projects", "triage-queue", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const queue = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === String(params.projectId) && t.isTriage)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { queue, count: queue.length } };
  });

  // Accept a triaged issue into the backlog — clears the flag, optionally
  // sets priority/assignee/sprint as part of the triage decision.
  registerLensAction("projects", "triage-accept", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (!task.isTriage) return { ok: false, error: "task is not in triage" };
    task.isTriage = false;
    if (params.priority != null) task.priority = pjPick(params.priority, PJ_PRIORITIES, task.priority);
    if (params.status != null) task.status = pjPick(params.status, PJ_STATUSES, task.status);
    if (params.assigneeId) {
      const a = String(params.assigneeId);
      if ((s.members.get(userId) || []).some((m) => m.id === a)) task.assigneeId = a;
    }
    if (params.sprintId) {
      const sp = String(params.sprintId);
      if ((s.sprints.get(userId) || []).some((x) => x.id === sp)) task.sprintId = sp;
    }
    task.updatedAt = pjNow();
    pjLog(s, userId, task.id, "triage", "accepted into backlog");
    savePjState();
    return { ok: true, result: { task } };
  });

  // Decline a triaged issue — removes it from the queue entirely.
  registerLensAction("projects", "triage-decline", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.tasks.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id && t.isTriage);
    if (i < 0) return { ok: false, error: "triage task not found" };
    const ref = arr[i].ref;
    arr.splice(i, 1);
    s.activity.set(userId, (s.activity.get(userId) || []).filter((a) => a.taskId !== params.id));
    s.comments.set(userId, (s.comments.get(userId) || []).filter((c) => c.taskId !== params.id));
    savePjState();
    return { ok: true, result: { declined: params.id, ref } };
  });

  // ── [S] SLA / due-date escalation automation ────────────────────────
  const PJ_SLA_LEVELS = ["low", "medium", "high", "urgent"];
  registerLensAction("projects", "sla-policy-set", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const projectId = String(params.projectId || "");
    if (!pjProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const priority = pjPick(params.priority, PJ_PRIORITIES, null);
    if (!priority || priority === "none") return { ok: false, error: "valid priority required" };
    const responseDays = Math.max(0, Math.round(pjNum(params.responseDays, 3)));
    const escalateTo = pjPick(params.escalateTo, PJ_SLA_LEVELS, "high");
    const arr = pjListB(s.slaPolicies, userId);
    let policy = arr.find((p) => p.projectId === projectId && p.priority === priority);
    if (!policy) {
      policy = { id: pjId("sla"), projectId, priority, createdAt: pjNow() };
      arr.push(policy);
    }
    policy.responseDays = responseDays;
    policy.escalateTo = escalateTo;
    policy.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { policy } };
  });

  registerLensAction("projects", "sla-policy-list", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const policies = (s.slaPolicies.get(pjAid(ctx)) || [])
      .filter((p) => p.projectId === String(params.projectId));
    return { ok: true, result: { policies, count: policies.length } };
  });

  registerLensAction("projects", "sla-policy-delete", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.slaPolicies.get(pjAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "policy not found" };
    arr.splice(i, 1);
    savePjState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Evaluate every open task against its priority SLA policy + due date.
  // Breached/at-risk tasks escalate (priority bump) and raise a
  // notification. Idempotent — re-running won't double-escalate the same
  // task on the same day.
  registerLensAction("projects", "sla-escalate", (ctx, _a, params = {}) => {
    const s = getPjExtra(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const projectId = String(params.projectId || "");
    if (!pjProject(s, userId, projectId)) return { ok: false, error: "project not found" };
    const policies = (s.slaPolicies.get(userId) || []).filter((p) => p.projectId === projectId);
    const polByPriority = new Map(policies.map((p) => [p.priority, p]));
    const now = Date.now();
    const today = pjDay(pjNow());
    const prRank = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
    const tasks = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === projectId && t.status !== "done" && !t.isTriage);
    const breached = [];
    const atRisk = [];
    let escalated = 0;
    for (const t of tasks) {
      let dueMs = null;
      let basis = null;
      if (t.dueDate) {
        dueMs = Date.parse(`${t.dueDate}T23:59:59Z`);
        basis = "due_date";
      } else {
        const policy = polByPriority.get(t.priority);
        if (policy) {
          dueMs = Date.parse(t.createdAt) + policy.responseDays * PJ_DAY;
          basis = "sla_policy";
        }
      }
      if (dueMs == null) continue;
      const hoursLeft = (dueMs - now) / 3_600_000;
      if (hoursLeft < 0) {
        breached.push({ id: t.id, ref: t.ref, title: t.title, basis, overdueDays: Math.round(-hoursLeft / 24 * 10) / 10 });
        // Escalate at most once per day.
        if (t.slaEscalatedOn !== today) {
          const policy = polByPriority.get(t.priority);
          const targetPriority = policy ? policy.escalateTo : "urgent";
          if ((prRank[targetPriority] || 0) > (prRank[t.priority] || 0)) {
            const prev = t.priority;
            t.priority = targetPriority;
            t.updatedAt = pjNow();
            pjLog(s, userId, t.id, "sla", `escalated ${prev} → ${targetPriority}`);
            pjRunRules(s, userId, t, "priority_changed");
            escalated += 1;
          }
          t.slaEscalatedOn = today;
          pjNotify(s, userId, {
            kind: "sla", projectId, taskId: t.id,
            title: "SLA breach", detail: `${t.ref} is overdue (${basis.replace(/_/g, " ")})`,
          });
        }
      } else if (hoursLeft <= 24) {
        atRisk.push({ id: t.id, ref: t.ref, title: t.title, basis, hoursLeft: Math.round(hoursLeft * 10) / 10 });
      }
    }
    savePjState();
    return {
      ok: true,
      result: {
        breached, atRisk, escalated,
        breachedCount: breached.length, atRiskCount: atRisk.length,
      },
    };
  });
}
