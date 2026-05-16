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
}
