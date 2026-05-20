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

  function advanceDate(dateStr, recurring) {
    const base = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
    if (recurring === "daily") base.setUTCDate(base.getUTCDate() + 1);
    else if (recurring === "weekly") base.setUTCDate(base.getUTCDate() + 7);
    else if (recurring === "monthly") base.setUTCMonth(base.getUTCMonth() + 1);
    else return null;
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
      recurring: ["daily", "weekly", "monthly"].includes(String(params.recurring).toLowerCase())
        ? String(params.recurring).toLowerCase() : null,
      subtasks: [],
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
        labels: [...task.labels], recurring: task.recurring, subtasks: [],
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
    const subtask = { id: pdId("sub"), content, done: false };
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
}
