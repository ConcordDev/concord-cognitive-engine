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
    for (const k of ["projects", "tasks", "sprints", "members", "milestones", "comments"]) {
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

  function pjProject(s, userId, projectId) {
    return (s.projects.get(userId) || []).find((p) => p.id === projectId) || null;
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
      seq: 0,
      createdAt: pjNow(), updatedAt: pjNow(),
    };
    pjListB(s.projects, pjAid(ctx)).push(project);
    savePjState();
    return { ok: true, result: { project } };
  });

  registerLensAction("projects", "project-list", (ctx, _a, _params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const projects = (s.projects.get(userId) || []).map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id);
      return {
        ...p,
        taskCount: pt.length,
        doneCount: pt.filter((t) => t.status === "done").length,
      };
    });
    return { ok: true, result: { projects, count: projects.length } };
  });

  registerLensAction("projects", "project-get", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const project = pjProject(s, userId, params.id);
    if (!project) return { ok: false, error: "project not found" };
    return {
      ok: true,
      result: {
        project,
        members: (s.members.get(userId) || []).filter((m) => m.projectId === project.id),
        sprints: (s.sprints.get(userId) || []).filter((sp) => sp.projectId === project.id),
        milestones: (s.milestones.get(userId) || []).filter((m) => m.projectId === project.id),
      },
    };
  });

  registerLensAction("projects", "project-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = pjProject(s, pjAid(ctx), params.id);
    if (!project) return { ok: false, error: "project not found" };
    if (params.name != null) project.name = pjClean(params.name, 160) || project.name;
    if (params.description != null) project.description = pjClean(params.description, 1000) || null;
    if (params.color != null) project.color = pjClean(params.color, 16) || project.color;
    project.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { project } };
  });

  registerLensAction("projects", "project-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.projects.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    for (const k of ["tasks", "sprints", "members", "milestones"]) {
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
    const task = {
      id: pjId("tsk"), projectId: project.id,
      ref: `${project.key}-${project.seq}`,
      title,
      description: pjClean(params.description, 4000) || null,
      status: pjPick(params.status, PJ_STATUSES, "backlog"),
      priority: pjPick(params.priority, PJ_PRIORITIES, "none"),
      assigneeId, sprintId, milestoneId,
      labels: Array.isArray(params.labels)
        ? [...new Set(params.labels.map((l) => pjClean(l, 30)).filter(Boolean))].slice(0, 10) : [],
      points: Math.max(0, Math.round(pjNum(params.points))),
      dueDate: pjDay(params.dueDate) || null,
      createdAt: pjNow(), updatedAt: pjNow(), completedAt: null,
    };
    if (task.status === "done") task.completedAt = pjNow();
    pjListB(s.tasks, userId).push(task);
    savePjState();
    return { ok: true, result: { task } };
  });

  registerLensAction("projects", "task-list", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let tasks = (s.tasks.get(pjAid(ctx)) || []).filter((t) => t.projectId === String(params.projectId));
    if (params.status) tasks = tasks.filter((t) => t.status === String(params.status));
    if (params.sprintId) tasks = tasks.filter((t) => t.sprintId === String(params.sprintId));
    if (params.assigneeId) tasks = tasks.filter((t) => t.assigneeId === String(params.assigneeId));
    if (params.label) tasks = tasks.filter((t) => t.labels.includes(String(params.label)));
    tasks = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { tasks, count: tasks.length } };
  });

  registerLensAction("projects", "task-update", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const task = (s.tasks.get(userId) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (params.title != null) task.title = pjClean(params.title, 240) || task.title;
    if (params.description != null) task.description = pjClean(params.description, 4000) || null;
    if (params.priority != null) task.priority = pjPick(params.priority, PJ_PRIORITIES, task.priority);
    if (params.points != null) task.points = Math.max(0, Math.round(pjNum(params.points)));
    if (params.dueDate != null) task.dueDate = pjDay(params.dueDate) || null;
    if (Array.isArray(params.labels)) {
      task.labels = [...new Set(params.labels.map((l) => pjClean(l, 30)).filter(Boolean))].slice(0, 10);
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
    if (params.status != null) {
      task.status = pjPick(params.status, PJ_STATUSES, task.status);
      task.completedAt = task.status === "done" ? (task.completedAt || pjNow()) : null;
    }
    task.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { task } };
  });

  registerLensAction("projects", "task-move-status", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = (s.tasks.get(pjAid(ctx)) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    task.status = pjPick(params.status, PJ_STATUSES, task.status);
    task.completedAt = task.status === "done" ? (task.completedAt || pjNow()) : null;
    task.updatedAt = pjNow();
    savePjState();
    return { ok: true, result: { id: task.id, status: task.status } };
  });

  registerLensAction("projects", "task-delete", (ctx, _a, params = {}) => {
    const s = getPjState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pjAid(ctx);
    const arr = s.tasks.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "task not found" };
    arr.splice(i, 1);
    s.comments.set(userId, (s.comments.get(userId) || []).filter((c) => c.taskId !== params.id));
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
    const comment = {
      id: pjId("cmt"), taskId: task.id, body,
      author: pjClean(params.author, 60) || "Me",
      createdAt: pjNow(),
    };
    pjListB(s.comments, userId).push(comment);
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
}
