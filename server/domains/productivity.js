// server/domains/productivity.js
// Domain actions for the productivity lens — Todoist + Things shape.
// 4 macros over task / project / focus / daily summary.

export default function registerProductivityActions(registerLensAction) {
  /**
   * taskCreate — append a task to the artifact tasks list.
   *   params.title, params.project?, params.priority? (1-4), params.dueDate?
   */
  registerLensAction("productivity", "taskCreate", (_ctx, artifact, params = {}) => {
    if (!params.title || !String(params.title).trim()) return { ok: false, reason: "title required" };
    const tasks = artifact.data?.tasks || [];
    const task = {
      id: `task-${Date.now()}`,
      title: String(params.title).trim(),
      project: params.project || "Inbox",
      priority: [1, 2, 3, 4].includes(parseInt(params.priority, 10)) ? parseInt(params.priority, 10) : 4,
      dueDate: params.dueDate || null,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    artifact.data = { ...artifact.data, tasks };
    return { ok: true, result: { task, totalOpen: tasks.filter((t) => !t.completed).length } };
  });

  /**
   * projectFilter — filter tasks by project + open/done.
   *   params.project, params.status ('open' | 'done' | 'all')
   */
  registerLensAction("productivity", "projectFilter", (_ctx, artifact, params = {}) => {
    const tasks = artifact.data?.tasks || [];
    const project = params.project || "Inbox";
    const status = ["open", "done", "all"].includes(params.status) ? params.status : "open";
    const matches = tasks.filter((t) => {
      if (project !== "_all_" && t.project !== project) return false;
      if (status === "open" && t.completed) return false;
      if (status === "done" && !t.completed) return false;
      return true;
    });
    const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const t of matches) byPriority[t.priority || 4]++;
    return {
      ok: true,
      result: {
        project, status,
        count: matches.length,
        tasks: matches.slice(0, 50),
        byPriority,
      },
    };
  });

  /**
   * focusBlock — propose a 25-minute focus block (pomodoro-style)
   * given the user's open tasks and current energy.
   *   params.energy ('high' | 'medium' | 'low')
   */
  registerLensAction("productivity", "focusBlock", (_ctx, artifact, params = {}) => {
    const tasks = (artifact.data?.tasks || []).filter((t) => !t.completed);
    if (tasks.length === 0) return { ok: true, result: { message: "No open tasks. Capture something first." } };
    const energy = ["high", "medium", "low"].includes(params.energy) ? params.energy : "medium";
    // High energy → priority 1 first; Low → priority 3-4 + short tasks
    const sorted = [...tasks].sort((a, b) => {
      if (energy === "high") return (a.priority || 4) - (b.priority || 4);
      if (energy === "low") return (b.priority || 4) - (a.priority || 4);
      // medium — alternate
      return ((a.priority || 4) + (b.id.length % 3)) - ((b.priority || 4) + (a.id.length % 3));
    });
    const candidate = sorted[0];
    return {
      ok: true,
      result: {
        energy,
        candidate,
        durationMin: 25,
        breakAfterMin: 5,
        nextUp: sorted.slice(1, 4).map((t) => ({ id: t.id, title: t.title, priority: t.priority })),
        rationale: energy === "high"
          ? "Highest-priority task first — your energy can carry it."
          : energy === "low"
          ? "Quick wins first — momentum > intensity right now."
          : "Mixed priority — alternate hard and easy.",
      },
    };
  });

  /**
   * dailySummary — summarise today's task throughput.
   *   params.date (default today YYYY-MM-DD)
   */
  registerLensAction("productivity", "dailySummary", (_ctx, artifact, params = {}) => {
    const date = params.date || new Date().toISOString().slice(0, 10);
    const tasks = artifact.data?.tasks || [];
    const created = tasks.filter((t) => (t.createdAt || "").startsWith(date));
    const completed = tasks.filter((t) => t.completed && (t.completedAt || "").startsWith(date));
    const stillOpen = tasks.filter((t) => !t.completed);
    const overdue = stillOpen.filter((t) => t.dueDate && t.dueDate < date);
    const byProject = {};
    for (const t of completed) {
      const p = t.project || "Inbox";
      byProject[p] = (byProject[p] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        date,
        createdToday: created.length,
        completedToday: completed.length,
        openTotal: stillOpen.length,
        overdueCount: overdue.length,
        completedByProject: byProject,
        throughput: completed.length > 0 && created.length > 0
          ? Math.round((completed.length / created.length) * 100) + "%"
          : "—",
      },
    };
  });

  // ─── Todoist + TickTick 2026 parity — task manager ──────────────────
  // Tasks with priorities/labels/recurrence, projects, subtasks, smart
  // views, habits, Pomodoro focus, Eisenhower matrix, karma.

  function getProdState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.productivityLens) STATE.productivityLens = {};
    const s = STATE.productivityLens;
    for (const k of ["tasks", "projects", "labels", "habits", "focusSessions"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveProdState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pdId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pdNow = () => new Date().toISOString();
  const pdAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pdListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pdNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pdClean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
  const pdDay = (v) => pdClean(v, 10).slice(0, 10);
  const findTask = (s, userId, id) => (s.tasks.get(userId) || []).find((t) => t.id === id) || null;
  const PD_DAY = 86400000;

  const RECURRENCE_KINDS = ["daily", "weekly", "monthly", "weekday", "yearly"];
  function normRecurring(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (RECURRENCE_KINDS.includes(s)) return s;
    // "every N days" custom interval
    const m = s.match(/^every\s+(\d{1,3})\s+days?$/);
    if (m) { const n = Math.max(1, Math.min(365, parseInt(m[1], 10))); return `every_${n}_days`; }
    if (s === "every weekday" || s === "weekdays") return "weekday";
    if (s === "every day") return "daily";
    if (s === "every week") return "weekly";
    if (s === "every month") return "monthly";
    if (s === "every year" || s === "annually") return "yearly";
    return null;
  }
  function advanceDate(dateStr, recurring) {
    const base = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
    if (recurring === "daily") base.setUTCDate(base.getUTCDate() + 1);
    else if (recurring === "weekly") base.setUTCDate(base.getUTCDate() + 7);
    else if (recurring === "monthly") base.setUTCMonth(base.getUTCMonth() + 1);
    else if (recurring === "yearly") base.setUTCFullYear(base.getUTCFullYear() + 1);
    else if (recurring === "weekday") {
      // advance to next Mon-Fri
      do { base.setUTCDate(base.getUTCDate() + 1); }
      while (base.getUTCDay() === 0 || base.getUTCDay() === 6);
    } else {
      const m = String(recurring || "").match(/^every_(\d+)_days$/);
      if (m) base.setUTCDate(base.getUTCDate() + parseInt(m[1], 10));
      else return null;
    }
    return base.toISOString().slice(0, 10);
  }
  function dueState(dateStr) {
    if (!dateStr) return "none";
    const today = new Date().toISOString().slice(0, 10);
    if (dateStr < today) return "overdue";
    if (dateStr === today) return "today";
    return "upcoming";
  }

  // ── Tasks ───────────────────────────────────────────────────────────
  registerLensAction("productivity", "task-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const content = pdClean(params.content, 500);
    if (!content) return { ok: false, error: "task content required" };
    const task = {
      id: pdId("tsk"), content,
      projectId: params.projectId ? String(params.projectId) : null,
      priority: Math.max(1, Math.min(4, Math.round(pdNum(params.priority, 4)))),
      dueDate: pdDay(params.dueDate) || null,
      labels: Array.isArray(params.labels)
        ? [...new Set(params.labels.map((l) => pdClean(l, 40).toLowerCase()).filter(Boolean))].slice(0, 20) : [],
      recurring: normRecurring(params.recurring),
      subtasks: [],
      assigneeId: params.assigneeId ? String(params.assigneeId) : null,
      comments: [],
      done: false, completedAt: null, createdAt: pdNow(),
    };
    pdListB(s.tasks, pdAid(ctx)).push(task);
    saveProdState();
    return { ok: true, result: { task } };
  });

  registerLensAction("productivity", "task-list", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let tasks = [...(s.tasks.get(pdAid(ctx)) || [])];
    if (!params.includeDone) tasks = tasks.filter((t) => !t.done);
    if (params.projectId) tasks = tasks.filter((t) => t.projectId === params.projectId);
    if (params.label) tasks = tasks.filter((t) => t.labels.includes(String(params.label).toLowerCase()));
    if (params.priority) tasks = tasks.filter((t) => t.priority === Math.round(pdNum(params.priority)));
    tasks.sort((a, b) => a.priority - b.priority || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return {
      ok: true,
      result: { tasks: tasks.map((t) => ({ ...t, dueState: dueState(t.dueDate) })), count: tasks.length },
    };
  });

  registerLensAction("productivity", "task-detail", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.id);
    if (!task) return { ok: false, error: "task not found" };
    return { ok: true, result: { task: { ...task, dueState: dueState(task.dueDate) } } };
  });

  registerLensAction("productivity", "task-update", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (params.content != null) { const c = pdClean(params.content, 500); if (c) task.content = c; }
    if (params.priority != null) task.priority = Math.max(1, Math.min(4, Math.round(pdNum(params.priority))));
    if (params.dueDate != null) task.dueDate = pdDay(params.dueDate) || null;
    if (params.projectId != null) task.projectId = params.projectId ? String(params.projectId) : null;
    if (Array.isArray(params.labels)) {
      task.labels = [...new Set(params.labels.map((l) => pdClean(l, 40).toLowerCase()).filter(Boolean))].slice(0, 20);
    }
    saveProdState();
    return { ok: true, result: { task } };
  });

  registerLensAction("productivity", "task-complete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const task = findTask(s, userId, params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (params.reopen === true) {
      task.done = false; task.completedAt = null;
      saveProdState();
      return { ok: true, result: { task, spawned: null } };
    }
    task.done = true;
    task.completedAt = pdNow();
    let spawned = null;
    if (task.recurring) {
      spawned = {
        id: pdId("tsk"), content: task.content, projectId: task.projectId,
        priority: task.priority, dueDate: advanceDate(task.dueDate, task.recurring),
        dueTime: task.dueTime || null,
        labels: [...task.labels], recurring: task.recurring, subtasks: [],
        assigneeId: task.assigneeId || null, comments: [],
        done: false, completedAt: null, createdAt: pdNow(),
      };
      s.tasks.get(userId).push(spawned);
    }
    saveProdState();
    return { ok: true, result: { task, spawned } };
  });

  registerLensAction("productivity", "task-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.tasks.get(pdAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "task not found" };
    arr.splice(i, 1);
    saveProdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Subtasks ────────────────────────────────────────────────────────
  registerLensAction("productivity", "subtask-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const content = pdClean(params.content, 300);
    if (!content) return { ok: false, error: "subtask content required" };
    const subtask = {
      id: pdId("sub"), content, done: false,
      priority: [1, 2, 3, 4].includes(parseInt(params.priority, 10)) ? parseInt(params.priority, 10) : 4,
      dueDate: pdDay(params.dueDate) || null,
    };
    task.subtasks.push(subtask);
    saveProdState();
    return { ok: true, result: { subtask } };
  });

  registerLensAction("productivity", "subtask-toggle", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const sub = task.subtasks.find((x) => x.id === params.id);
    if (!sub) return { ok: false, error: "subtask not found" };
    if (params.remove === true) {
      task.subtasks = task.subtasks.filter((x) => x.id !== params.id);
      saveProdState();
      return { ok: true, result: { deleted: params.id } };
    }
    sub.done = !sub.done;
    saveProdState();
    return { ok: true, result: { subtask: sub } };
  });

  // ── Projects ────────────────────────────────────────────────────────
  registerLensAction("productivity", "project-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pdClean(params.name, 120);
    if (!name) return { ok: false, error: "project name required" };
    const project = {
      id: pdId("prj"), name,
      color: pdClean(params.color, 20).toLowerCase() || "blue",
      createdAt: pdNow(),
    };
    pdListB(s.projects, pdAid(ctx)).push(project);
    saveProdState();
    return { ok: true, result: { project } };
  });

  registerLensAction("productivity", "project-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const projects = (s.projects.get(userId) || []).map((p) => ({
      ...p,
      taskCount: tasks.filter((t) => t.projectId === p.id && !t.done).length,
    }));
    return { ok: true, result: { projects, count: projects.length } };
  });

  registerLensAction("productivity", "project-detail", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const project = (s.projects.get(userId) || []).find((p) => p.id === params.id);
    if (!project) return { ok: false, error: "project not found" };
    const tasks = (s.tasks.get(userId) || [])
      .filter((t) => t.projectId === project.id)
      .map((t) => ({ ...t, dueState: dueState(t.dueDate) }));
    return {
      ok: true,
      result: { project, tasks, active: tasks.filter((t) => !t.done).length, done: tasks.filter((t) => t.done).length },
    };
  });

  registerLensAction("productivity", "project-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const arr = s.projects.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    for (const t of s.tasks.get(userId) || []) if (t.projectId === params.id) t.projectId = null;
    saveProdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Labels ──────────────────────────────────────────────────────────
  registerLensAction("productivity", "label-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pdClean(params.name, 40).toLowerCase();
    if (!name) return { ok: false, error: "label name required" };
    const labels = pdListB(s.labels, pdAid(ctx));
    if (!labels.some((l) => l.name === name)) labels.push({ id: pdId("lbl"), name, createdAt: pdNow() });
    saveProdState();
    return { ok: true, result: { name } };
  });

  registerLensAction("productivity", "label-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const tasks = (s.tasks.get(userId) || []).filter((t) => !t.done);
    const labels = (s.labels.get(userId) || []).map((l) => ({
      ...l, taskCount: tasks.filter((t) => t.labels.includes(l.name)).length,
    }));
    return { ok: true, result: { labels, count: labels.length } };
  });

  // ── Smart views ─────────────────────────────────────────────────────
  registerLensAction("productivity", "today-view", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = new Date().toISOString().slice(0, 10);
    const tasks = (s.tasks.get(pdAid(ctx)) || [])
      .filter((t) => !t.done && t.dueDate && t.dueDate <= today)
      .map((t) => ({ ...t, dueState: dueState(t.dueDate) }))
      .sort((a, b) => a.priority - b.priority);
    return {
      ok: true,
      result: {
        tasks,
        overdue: tasks.filter((t) => t.dueState === "overdue").length,
        dueToday: tasks.filter((t) => t.dueState === "today").length,
      },
    };
  });

  registerLensAction("productivity", "upcoming-view", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const tasks = (s.tasks.get(pdAid(ctx)) || []).filter((t) => !t.done && t.dueDate);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(now + d * PD_DAY).toISOString().slice(0, 10);
      days.push({ date, tasks: tasks.filter((t) => t.dueDate === date).sort((a, b) => a.priority - b.priority) });
    }
    return { ok: true, result: { days } };
  });

  registerLensAction("productivity", "eisenhower-matrix", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tasks = (s.tasks.get(pdAid(ctx)) || []).filter((t) => !t.done);
    const soon = new Date(Date.now() + 2 * PD_DAY).toISOString().slice(0, 10);
    const quadrants = { do_first: [], schedule: [], delegate: [], eliminate: [] };
    for (const t of tasks) {
      const urgent = !!t.dueDate && t.dueDate <= soon;
      const important = t.priority <= 2;
      const q = urgent && important ? "do_first" : important ? "schedule" : urgent ? "delegate" : "eliminate";
      quadrants[q].push({ id: t.id, content: t.content, priority: t.priority, dueDate: t.dueDate });
    }
    return { ok: true, result: { quadrants } };
  });

  // ── Habits ──────────────────────────────────────────────────────────
  registerLensAction("productivity", "habit-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pdClean(params.name, 120);
    if (!name) return { ok: false, error: "habit name required" };
    const habit = {
      id: pdId("hab"), name,
      cadence: ["daily", "weekly"].includes(String(params.cadence).toLowerCase())
        ? String(params.cadence).toLowerCase() : "daily",
      checkins: [], createdAt: pdNow(),
    };
    pdListB(s.habits, pdAid(ctx)).push(habit);
    saveProdState();
    return { ok: true, result: { habit } };
  });

  function habitStreak(checkins) {
    if (!checkins.length) return 0;
    const set = new Set(checkins);
    let streak = 0;
    const d = new Date();
    // allow today not yet done — start from today, walk back.
    if (!set.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    for (;;) {
      const key = d.toISOString().slice(0, 10);
      if (set.has(key)) { streak += 1; d.setUTCDate(d.getUTCDate() - 1); }
      else break;
    }
    return streak;
  }

  registerLensAction("productivity", "habit-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = new Date().toISOString().slice(0, 10);
    const habits = (s.habits.get(pdAid(ctx)) || []).map((h) => ({
      ...h,
      streak: habitStreak(h.checkins),
      doneToday: h.checkins.includes(today),
      totalCheckins: h.checkins.length,
    }));
    return { ok: true, result: { habits, count: habits.length } };
  });

  registerLensAction("productivity", "habit-checkin", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const habit = (s.habits.get(pdAid(ctx)) || []).find((h) => h.id === params.id);
    if (!habit) return { ok: false, error: "habit not found" };
    const date = pdDay(params.date) || new Date().toISOString().slice(0, 10);
    const i = habit.checkins.indexOf(date);
    if (i >= 0) habit.checkins.splice(i, 1);
    else habit.checkins.push(date);
    saveProdState();
    return { ok: true, result: { id: habit.id, streak: habitStreak(habit.checkins), doneToday: habit.checkins.includes(new Date().toISOString().slice(0, 10)) } };
  });

  registerLensAction("productivity", "habit-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.habits.get(pdAid(ctx)) || [];
    const i = arr.findIndex((h) => h.id === params.id);
    if (i < 0) return { ok: false, error: "habit not found" };
    arr.splice(i, 1);
    saveProdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Pomodoro focus ──────────────────────────────────────────────────
  registerLensAction("productivity", "focus-log", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const durationMin = Math.max(1, Math.round(pdNum(params.durationMin, 25)));
    const session = {
      id: pdId("foc"), durationMin,
      taskId: params.taskId ? String(params.taskId) : null,
      taskContent: params.taskId ? (findTask(s, userId, params.taskId)?.content || null) : null,
      date: new Date().toISOString().slice(0, 10),
      at: pdNow(),
    };
    pdListB(s.focusSessions, userId).push(session);
    saveProdState();
    return { ok: true, result: { session } };
  });

  registerLensAction("productivity", "focus-stats", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = s.focusSessions.get(pdAid(ctx)) || [];
    const today = new Date().toISOString().slice(0, 10);
    const todayMin = sessions.filter((x) => x.date === today).reduce((a, x) => a + x.durationMin, 0);
    return {
      ok: true,
      result: {
        totalSessions: sessions.length,
        totalMinutes: sessions.reduce((a, x) => a + x.durationMin, 0),
        todaySessions: sessions.filter((x) => x.date === today).length,
        todayMinutes: todayMin,
      },
    };
  });

  // ── Productivity stats + karma ──────────────────────────────────────
  registerLensAction("productivity", "productivity-stats", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tasks = s.tasks.get(pdAid(ctx)) || [];
    const done = tasks.filter((t) => t.done && t.completedAt);
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * PD_DAY).toISOString().slice(0, 10);
    const completedToday = done.filter((t) => String(t.completedAt).slice(0, 10) === today).length;
    const completedWeek = done.filter((t) => String(t.completedAt).slice(0, 10) >= weekAgo).length;
    // completion streak — consecutive days with >=1 completion.
    const dayset = new Set(done.map((t) => String(t.completedAt).slice(0, 10)));
    let streak = 0;
    const d = new Date();
    if (!dayset.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    while (dayset.has(d.toISOString().slice(0, 10))) { streak += 1; d.setUTCDate(d.getUTCDate() - 1); }
    return {
      ok: true,
      result: {
        completedToday, completedWeek,
        totalCompleted: done.length,
        activeTasks: tasks.filter((t) => !t.done).length,
        streak,
      },
    };
  });

  registerLensAction("productivity", "karma", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const done = (s.tasks.get(pdAid(ctx)) || []).filter((t) => t.done);
    // Todoist-style: each completion worth points weighted by priority.
    let points = 0;
    for (const t of done) points += { 1: 8, 2: 6, 3: 5, 4: 4 }[t.priority] || 4;
    const focus = (s.focusSessions.get(pdAid(ctx)) || []).reduce((a, x) => a + x.durationMin, 0);
    points += Math.round(focus / 25) * 3;
    const level = points >= 5000 ? "Grandmaster" : points >= 2500 ? "Master"
      : points >= 1000 ? "Expert" : points >= 300 ? "Pro" : points >= 50 ? "Novice" : "Beginner";
    return { ok: true, result: { karma: points, level, completions: done.length } };
  });

  registerLensAction("productivity", "productivity-dashboard", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const today = new Date().toISOString().slice(0, 10);
    const active = tasks.filter((t) => !t.done);
    return {
      ok: true,
      result: {
        activeTasks: active.length,
        dueToday: active.filter((t) => t.dueDate && t.dueDate <= today).length,
        projects: (s.projects.get(userId) || []).length,
        habits: (s.habits.get(userId) || []).length,
        completedToday: tasks.filter((t) => t.done && String(t.completedAt).slice(0, 10) === today).length,
        focusMinutesToday: (s.focusSessions.get(userId) || []).filter((x) => x.date === today).reduce((a, x) => a + x.durationMin, 0),
      },
    };
  });

  // ── Natural-language quick add ───────────────────────────────────────
  // Parses "submit report tomorrow 5pm p1 #work !daily" into a real task.
  function parseQuickAdd(text) {
    let raw = String(text == null ? "" : text).trim();
    if (!raw) return null;
    const out = { content: raw, priority: 4, dueDate: null, dueTime: null, project: null, labels: [], recurring: null };

    // priority — "p1".."p4" or "!!" style
    const pm = raw.match(/(?:^|\s)p([1-4])(?=\s|$)/i);
    if (pm) { out.priority = parseInt(pm[1], 10); raw = raw.replace(pm[0], " "); }

    // project — "#work" or "#deep work" (single token after #)
    const prj = raw.match(/(?:^|\s)#([A-Za-z0-9_-]+)/);
    if (prj) { out.project = prj[1]; raw = raw.replace(prj[0], " "); }

    // labels — "@label" (Todoist label syntax), repeatable
    const labelRe = /(?:^|\s)@([A-Za-z0-9_-]+)/g;
    let lm;
    while ((lm = labelRe.exec(raw)) !== null) out.labels.push(lm[1].toLowerCase());
    raw = raw.replace(/(?:^|\s)@[A-Za-z0-9_-]+/g, " ");

    // recurrence — "every weekday", "every day", "every 3 days", "!weekly"
    const recRe = /(?:^|\s)(?:!\s?(\w+)|every\s+(?:weekday|day|week|month|year|\d{1,3}\s+days?))/i;
    const recM = raw.match(recRe);
    if (recM) {
      const candidate = recM[1] ? recM[1] : recM[0].trim();
      const r = normRecurring(candidate);
      if (r) { out.recurring = r; raw = raw.replace(recM[0], " "); }
    }

    // time — "5pm", "5:30pm", "17:00"
    const tm = raw.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s?(am|pm)?(?=\s|$)/i);
    if (tm && (tm[3] || tm[2])) {
      let hh = parseInt(tm[1], 10);
      const mm = tm[2] ? parseInt(tm[2], 10) : 0;
      const ap = (tm[3] || "").toLowerCase();
      if (ap === "pm" && hh < 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        out.dueTime = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        raw = raw.replace(tm[0], " ");
      }
    }

    // date — relative words + ISO + weekday names
    const today = new Date();
    const dayMs = 86400000;
    const isoToday = today.toISOString().slice(0, 10);
    const iso = raw.match(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/);
    if (iso) { out.dueDate = iso[1]; raw = raw.replace(iso[0], " "); }
    else {
      const lc = raw.toLowerCase();
      if (/(?:^|\s)today(?=\s|$)/.test(lc)) { out.dueDate = isoToday; raw = raw.replace(/(?:^|\s)today/i, " "); }
      else if (/(?:^|\s)tomorrow(?=\s|$)/.test(lc)) {
        out.dueDate = new Date(today.getTime() + dayMs).toISOString().slice(0, 10);
        raw = raw.replace(/(?:^|\s)tomorrow/i, " ");
      } else {
        const inM = lc.match(/(?:^|\s)in\s+(\d{1,3})\s+days?(?=\s|$)/);
        if (inM) {
          out.dueDate = new Date(today.getTime() + parseInt(inM[1], 10) * dayMs).toISOString().slice(0, 10);
          raw = raw.replace(inM[0], " ");
        } else {
          const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
          const wdM = lc.match(/(?:^|\s)(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s|$)/);
          if (wdM) {
            const want = WD.indexOf(wdM[1]);
            let delta = (want - today.getUTCDay() + 7) % 7;
            if (delta === 0) delta = 7;
            out.dueDate = new Date(today.getTime() + delta * dayMs).toISOString().slice(0, 10);
            raw = raw.replace(wdM[0], " ");
          }
        }
      }
    }

    out.content = raw.replace(/\s+/g, " ").trim();
    if (!out.content) out.content = String(text).trim();
    out.labels = [...new Set(out.labels)];
    return out;
  }

  registerLensAction("productivity", "task-parse", (_ctx, _a, params = {}) => {
    const parsed = parseQuickAdd(params.text);
    if (!parsed) return { ok: false, error: "text required" };
    return { ok: true, result: { parsed } };
  });

  registerLensAction("productivity", "task-quick-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const parsed = parseQuickAdd(params.text);
    if (!parsed || !parsed.content) return { ok: false, error: "text required" };
    const userId = pdAid(ctx);
    // resolve project name → existing project id, else keep name on task
    let projectId = null;
    if (parsed.project) {
      const proj = (s.projects.get(userId) || []).find(
        (p) => p.name.toLowerCase() === parsed.project.toLowerCase());
      if (proj) projectId = proj.id;
      else {
        const np = { id: pdId("prj"), name: parsed.project, color: "blue", createdAt: pdNow() };
        pdListB(s.projects, userId).push(np);
        projectId = np.id;
      }
    }
    const task = {
      id: pdId("tsk"), content: parsed.content, projectId,
      priority: parsed.priority,
      dueDate: parsed.dueDate || null,
      dueTime: parsed.dueTime || null,
      labels: parsed.labels.slice(0, 20),
      recurring: parsed.recurring,
      subtasks: [], assigneeId: null, comments: [],
      done: false, completedAt: null, createdAt: pdNow(),
    };
    pdListB(s.tasks, userId).push(task);
    saveProdState();
    return { ok: true, result: { task, parsed } };
  });

  // ── Reminders + notifications ────────────────────────────────────────
  function getRemMap() {
    const STATE = globalThis._concordSTATE;
    if (!STATE || !STATE.productivityLens) return null;
    const s = STATE.productivityLens;
    if (!(s.reminders instanceof Map)) s.reminders = new Map();
    return s.reminders;
  }
  registerLensAction("productivity", "reminder-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getRemMap();
    const userId = pdAid(ctx);
    const taskId = params.taskId ? String(params.taskId) : null;
    if (taskId && !findTask(s, userId, taskId)) return { ok: false, error: "task not found" };
    const remindAt = pdClean(params.remindAt, 30);
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(remindAt)) {
      return { ok: false, error: "remindAt must be ISO date or date-time" };
    }
    const kind = ["time", "location"].includes(String(params.kind)) ? String(params.kind) : "time";
    const reminder = {
      id: pdId("rem"), taskId, kind,
      remindAt: remindAt.replace(" ", "T"),
      location: kind === "location" ? pdClean(params.location, 200) : null,
      note: pdClean(params.note, 300),
      fired: false, createdAt: pdNow(),
    };
    pdListB(map, userId).push(reminder);
    saveProdState();
    return { ok: true, result: { reminder } };
  });
  registerLensAction("productivity", "reminder-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getRemMap();
    const userId = pdAid(ctx);
    const reminders = [...(map.get(userId) || [])]
      .map((r) => ({ ...r, task: r.taskId ? (findTask(s, userId, r.taskId)?.content || null) : null }))
      .sort((a, b) => String(a.remindAt).localeCompare(String(b.remindAt)));
    return { ok: true, result: { reminders, count: reminders.length } };
  });
  registerLensAction("productivity", "reminders-due", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getRemMap();
    const userId = pdAid(ctx);
    const nowIso = (params.now ? String(params.now) : new Date().toISOString()).slice(0, 16);
    const due = (map.get(userId) || [])
      .filter((r) => !r.fired && r.kind === "time" && String(r.remindAt).slice(0, 16) <= nowIso)
      .map((r) => ({ ...r, task: r.taskId ? (findTask(s, userId, r.taskId)?.content || null) : null }));
    if (params.markFired === true) {
      for (const d of due) {
        const r = (map.get(userId) || []).find((x) => x.id === d.id);
        if (r) r.fired = true;
      }
      saveProdState();
    }
    return { ok: true, result: { due, count: due.length } };
  });
  registerLensAction("productivity", "reminder-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getRemMap();
    const arr = map.get(pdAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reminder not found" };
    arr.splice(i, 1);
    saveProdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Saved smart filters ─────────────────────────────────────────────
  function getFilterMap() {
    const STATE = globalThis._concordSTATE;
    if (!STATE || !STATE.productivityLens) return null;
    const s = STATE.productivityLens;
    if (!(s.filters instanceof Map)) s.filters = new Map();
    return s.filters;
  }
  function applyFilterQuery(tasks, q) {
    let out = tasks.filter((t) => !t.done || q.includeDone === true);
    if (q.projectId) out = out.filter((t) => t.projectId === q.projectId);
    if (q.label) out = out.filter((t) => (t.labels || []).includes(String(q.label).toLowerCase()));
    if (q.priority) out = out.filter((t) => t.priority === Math.round(pdNum(q.priority)));
    if (q.priorityMax) out = out.filter((t) => t.priority <= Math.round(pdNum(q.priorityMax)));
    if (q.assigneeId) out = out.filter((t) => t.assigneeId === String(q.assigneeId));
    if (q.due === "overdue") out = out.filter((t) => dueState(t.dueDate) === "overdue");
    else if (q.due === "today") out = out.filter((t) => dueState(t.dueDate) === "today");
    else if (q.due === "upcoming") out = out.filter((t) => dueState(t.dueDate) === "upcoming");
    else if (q.due === "none") out = out.filter((t) => !t.dueDate);
    if (q.search) {
      const needle = String(q.search).toLowerCase();
      out = out.filter((t) => t.content.toLowerCase().includes(needle));
    }
    return out;
  }
  registerLensAction("productivity", "filter-save", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getFilterMap();
    const name = pdClean(params.name, 80);
    if (!name) return { ok: false, error: "filter name required" };
    const query = (params.query && typeof params.query === "object") ? params.query : {};
    const filter = {
      id: pdId("flt"), name,
      query: {
        projectId: query.projectId ? String(query.projectId) : null,
        label: query.label ? String(query.label).toLowerCase() : null,
        priority: query.priority ? Math.round(pdNum(query.priority)) : null,
        priorityMax: query.priorityMax ? Math.round(pdNum(query.priorityMax)) : null,
        due: ["overdue", "today", "upcoming", "none"].includes(String(query.due)) ? String(query.due) : null,
        assigneeId: query.assigneeId ? String(query.assigneeId) : null,
        search: query.search ? pdClean(query.search, 120) : null,
        includeDone: query.includeDone === true,
      },
      createdAt: pdNow(),
    };
    pdListB(map, pdAid(ctx)).push(filter);
    saveProdState();
    return { ok: true, result: { filter } };
  });
  registerLensAction("productivity", "filter-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = getFilterMap();
    const userId = pdAid(ctx);
    const tasks = s.tasks.get(userId) || [];
    const filters = (map.get(userId) || []).map((f) => ({
      ...f, matchCount: applyFilterQuery(tasks, f.query).length,
    }));
    return { ok: true, result: { filters, count: filters.length } };
  });
  registerLensAction("productivity", "filter-run", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    let query;
    if (params.id) {
      const f = (getFilterMap().get(userId) || []).find((x) => x.id === params.id);
      if (!f) return { ok: false, error: "filter not found" };
      query = f.query;
    } else if (params.query && typeof params.query === "object") {
      query = params.query;
    } else {
      return { ok: false, error: "filter id or query required" };
    }
    const tasks = applyFilterQuery(s.tasks.get(userId) || [], query)
      .map((t) => ({ ...t, dueState: dueState(t.dueDate) }))
      .sort((a, b) => a.priority - b.priority ||
        String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return { ok: true, result: { tasks, count: tasks.length } };
  });
  registerLensAction("productivity", "filter-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = getFilterMap().get(pdAid(ctx)) || [];
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "filter not found" };
    arr.splice(i, 1);
    saveProdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Calendar sync + view ────────────────────────────────────────────
  registerLensAction("productivity", "calendar-view", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const anchor = pdDay(params.month) || new Date().toISOString().slice(0, 10);
    const [yr, mo] = anchor.split("-").map((x) => parseInt(x, 10));
    const first = new Date(Date.UTC(yr, mo - 1, 1));
    const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
    const tasks = (s.tasks.get(userId) || []).filter((t) => t.dueDate);
    const remList = (getRemMap().get(userId) || []);
    const grid = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${String(yr).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      grid.push({
        date,
        tasks: tasks.filter((t) => t.dueDate === date)
          .map((t) => ({ id: t.id, content: t.content, priority: t.priority, dueTime: t.dueTime || null, done: !!t.done })),
        reminders: remList.filter((r) => String(r.remindAt).slice(0, 10) === date)
          .map((r) => ({ id: r.id, remindAt: r.remindAt, note: r.note, kind: r.kind })),
      });
    }
    return {
      ok: true,
      result: {
        month: `${String(yr).padStart(4, "0")}-${String(mo).padStart(2, "0")}`,
        firstWeekday: first.getUTCDay(),
        daysInMonth, days: grid,
        totalScheduled: tasks.filter((t) => t.dueDate.startsWith(`${String(yr).padStart(4, "0")}-${String(mo).padStart(2, "0")}`)).length,
      },
    };
  });

  function icsEscape(v) { return String(v == null ? "" : v).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n"); }
  registerLensAction("productivity", "calendar-export-ics", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const dated = (s.tasks.get(userId) || []).filter((t) => t.dueDate && !t.done);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Concord//Productivity//EN", "CALSCALE:GREGORIAN"];
    for (const t of dated) {
      const ymd = t.dueDate.replace(/-/g, "");
      const hasTime = !!t.dueTime;
      const dt = hasTime ? `${ymd}T${t.dueTime.replace(":", "")}00` : ymd;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${t.id}@concord-os.org`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(hasTime ? `DTSTART:${dt}` : `DTSTART;VALUE=DATE:${dt}`);
      lines.push(`SUMMARY:${icsEscape(t.content)}`);
      lines.push(`DESCRIPTION:${icsEscape("Concord task P" + t.priority + (t.labels.length ? " @" + t.labels.join(" @") : ""))}`);
      lines.push(`PRIORITY:${t.priority}`);
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return { ok: true, result: { ics: lines.join("\r\n"), eventCount: dated.length } };
  });

  function parseIcs(text) {
    // Unfold RFC5545 continuation lines, then walk VEVENTs.
    const unfolded = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
    const rows = unfolded.split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const row of rows) {
      const line = row.trim();
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") { if (cur && cur.summary) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const ci = line.indexOf(":");
      if (ci < 0) continue;
      const keyPart = line.slice(0, ci);
      const val = line.slice(ci + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").replace(/\\\\/g, "\\");
      const key = keyPart.split(";")[0].toUpperCase();
      if (key === "SUMMARY") cur.summary = val;
      else if (key === "DTSTART") {
        const m = val.match(/(\d{4})(\d{2})(\d{2})/);
        if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`;
        const tm = val.match(/T(\d{2})(\d{2})/);
        if (tm) cur.time = `${tm[1]}:${tm[2]}`;
      } else if (key === "UID") cur.uid = val;
      else if (key === "PRIORITY") cur.priority = parseInt(val, 10);
    }
    return events;
  }
  registerLensAction("productivity", "calendar-import-ics", async (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    let icsText = typeof params.ics === "string" ? params.ics : null;
    if (!icsText && params.url) {
      const url = String(params.url);
      if (!/^https?:\/\//.test(url)) return { ok: false, error: "url must be http(s)" };
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return { ok: false, error: `feed fetch failed: HTTP ${r.status}` };
        icsText = await r.text();
      } catch (e) {
        return { ok: false, error: `feed unreachable: ${String(e?.message || e)}` };
      }
    }
    if (!icsText) return { ok: false, error: "ics text or url required" };
    const events = parseIcs(icsText);
    const projectId = params.projectId ? String(params.projectId) : null;
    const existing = s.tasks.get(userId) || [];
    const imported = [];
    for (const ev of events) {
      if (!ev.date) continue;
      // dedupe by uid (stored on task as importUid)
      if (ev.uid && existing.some((t) => t.importUid === ev.uid)) continue;
      const task = {
        id: pdId("tsk"), content: pdClean(ev.summary, 500) || "(untitled event)",
        projectId, priority: [1, 2, 3, 4].includes(ev.priority) ? ev.priority : 4,
        dueDate: ev.date, dueTime: ev.time || null,
        labels: ["calendar"], recurring: null, subtasks: [], assigneeId: null, comments: [],
        importUid: ev.uid || null,
        done: false, completedAt: null, createdAt: pdNow(),
      };
      existing.push(task);
      imported.push(task);
    }
    if (!s.tasks.has(userId)) s.tasks.set(userId, existing);
    saveProdState();
    return { ok: true, result: { imported, importedCount: imported.length, parsedEvents: events.length } };
  });

  // ── Task collaboration ──────────────────────────────────────────────
  function getShareMap() {
    const STATE = globalThis._concordSTATE;
    if (!STATE || !STATE.productivityLens) return null;
    const s = STATE.productivityLens;
    if (!(s.projectShares instanceof Map)) s.projectShares = new Map();
    return s.projectShares;
  }
  registerLensAction("productivity", "project-share", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const project = (s.projects.get(userId) || []).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const collaboratorId = pdClean(params.collaboratorId, 80);
    if (!collaboratorId) return { ok: false, error: "collaboratorId required" };
    if (collaboratorId === userId) return { ok: false, error: "cannot share with yourself" };
    const role = ["editor", "viewer"].includes(String(params.role)) ? String(params.role) : "editor";
    const map = getShareMap();
    const shares = pdListB(map, params.projectId);
    let share = shares.find((x) => x.collaboratorId === collaboratorId);
    if (share) { share.role = role; }
    else {
      share = { id: pdId("shr"), collaboratorId, role, ownerId: userId, sharedAt: pdNow() };
      shares.push(share);
    }
    saveProdState();
    return { ok: true, result: { share, project: { id: project.id, name: project.name } } };
  });
  registerLensAction("productivity", "project-collaborators", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const project = (s.projects.get(userId) || []).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const collaborators = [...(getShareMap().get(params.projectId) || [])];
    return { ok: true, result: { collaborators, count: collaborators.length } };
  });
  registerLensAction("productivity", "project-unshare", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pdAid(ctx);
    const project = (s.projects.get(userId) || []).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const arr = getShareMap().get(params.projectId) || [];
    const i = arr.findIndex((x) => x.collaboratorId === String(params.collaboratorId));
    if (i < 0) return { ok: false, error: "collaborator not found" };
    arr.splice(i, 1);
    saveProdState();
    return { ok: true, result: { removed: String(params.collaboratorId) } };
  });
  registerLensAction("productivity", "task-assign", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    task.assigneeId = params.assigneeId ? String(params.assigneeId) : null;
    saveProdState();
    return { ok: true, result: { task: { id: task.id, content: task.content, assigneeId: task.assigneeId } } };
  });
  registerLensAction("productivity", "task-comment-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const body = pdClean(params.body, 800);
    if (!body) return { ok: false, error: "comment body required" };
    if (!Array.isArray(task.comments)) task.comments = [];
    const comment = { id: pdId("cmt"), body, authorId: pdAid(ctx), createdAt: pdNow() };
    task.comments.push(comment);
    saveProdState();
    return { ok: true, result: { comment, commentCount: task.comments.length } };
  });
  registerLensAction("productivity", "task-comments", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const comments = Array.isArray(task.comments) ? [...task.comments] : [];
    return { ok: true, result: { comments, count: comments.length } };
  });

  // ── Sub-task due dates + priorities (full hierarchy parity) ──────────
  registerLensAction("productivity", "subtask-update", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = findTask(s, pdAid(ctx), params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    const sub = task.subtasks.find((x) => x.id === params.id);
    if (!sub) return { ok: false, error: "subtask not found" };
    if (params.content != null) { const c = pdClean(params.content, 300); if (c) sub.content = c; }
    if (params.priority != null) sub.priority = Math.max(1, Math.min(4, Math.round(pdNum(params.priority, sub.priority || 4))));
    if (params.dueDate != null) sub.dueDate = pdDay(params.dueDate) || null;
    if (params.done != null) sub.done = params.done === true;
    saveProdState();
    return { ok: true, result: { subtask: sub } };
  });
}
