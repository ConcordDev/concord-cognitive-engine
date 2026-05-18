// server/lib/tasks/timeline.js
//
// Roadmap / timeline computations: critical-path-ish ordering using
// task_dependencies + estimate, milestone groupings, and a Gantt-
// friendly serialisation. Deterministic; no LLM.

export function buildTimeline(tasks, dependencies, { startTs = Math.floor(Date.now() / 1000), pointHours = 4 } = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) return { tasks: [], totalDays: 0, criticalPath: [] };
  // Build adjacency: blockerId -> [blockedIds]
  const blockMap = new Map();
  const incoming = new Map();
  for (const t of tasks) { blockMap.set(t.id, []); incoming.set(t.id, 0); }
  for (const d of dependencies || []) {
    if (d.kind !== "blocks") continue;
    const blockers = blockMap.get(d.blocker_id);
    if (blockers) blockers.push(d.blocked_id);
    incoming.set(d.blocked_id, (incoming.get(d.blocked_id) || 0) + 1);
  }
  // Kahn topo sort with stable ordering by priority then estimate
  const PRI_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
  const ready = tasks.filter((t) => (incoming.get(t.id) || 0) === 0);
  ready.sort((a, b) => (PRI_WEIGHT[b.priority] || 0) - (PRI_WEIGHT[a.priority] || 0));
  const out = [];
  const incomingMut = new Map(incoming);
  while (ready.length > 0) {
    const t = ready.shift();
    out.push(t);
    for (const next of (blockMap.get(t.id) || [])) {
      incomingMut.set(next, (incomingMut.get(next) || 0) - 1);
      if ((incomingMut.get(next) || 0) === 0) {
        const nt = tasks.find((x) => x.id === next);
        if (nt) {
          // priority-ordered insert
          let i = 0;
          while (i < ready.length && (PRI_WEIGHT[ready[i].priority] || 0) >= (PRI_WEIGHT[nt.priority] || 0)) i++;
          ready.splice(i, 0, nt);
        }
      }
    }
  }
  // Append any remaining tasks (cycle survivors) in priority order
  if (out.length < tasks.length) {
    const seen = new Set(out.map((t) => t.id));
    const leftovers = tasks.filter((t) => !seen.has(t.id)).sort((a, b) => (PRI_WEIGHT[b.priority] || 0) - (PRI_WEIGHT[a.priority] || 0));
    out.push(...leftovers);
  }
  // Assign start days using estimate (points→hours via pointHours, or hours direct)
  let cursor = 0;
  const finish = new Map();
  const lanes = [];
  for (const t of out) {
    const hours = t.estimate_unit === "hours" ? (t.estimate || pointHours) : ((t.estimate || 1) * pointHours);
    const startAfter = (blockMap.get(t.id) || []).reduce((m, _b) => Math.max(m, 0), 0);
    // Earliest start = max(finish times of all upstream deps)
    let earliest = cursor;
    for (const d of (dependencies || [])) {
      if (d.blocked_id === t.id && d.kind === "blocks") {
        const f = finish.get(d.blocker_id) || 0;
        earliest = Math.max(earliest, f);
      }
    }
    const start = earliest;
    const end = start + hours;
    finish.set(t.id, end);
    lanes.push({
      id: t.id,
      task_key: t.task_key,
      title: t.title,
      status_id: t.status_id,
      priority: t.priority,
      startHours: start,
      endHours: end,
      durationHours: hours,
      startDate: startTs + start * 3600,
      endDate: startTs + end * 3600,
    });
    cursor = Math.max(cursor, end); // serial fallback for unblocked
  }
  const totalHours = lanes.reduce((m, l) => Math.max(m, l.endHours), 0);
  // Critical path: walk from latest-finishing task backwards via dependencies
  const finishOrder = [...lanes].sort((a, b) => b.endHours - a.endHours);
  const criticalPath = [];
  let cur = finishOrder[0]?.id;
  const visited = new Set();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const lane = lanes.find((l) => l.id === cur);
    if (lane) criticalPath.unshift(lane.task_key);
    // Walk back via blocks dependency
    const back = (dependencies || []).filter((d) => d.blocked_id === cur && d.kind === "blocks");
    if (back.length === 0) break;
    back.sort((a, b) => (finish.get(b.blocker_id) || 0) - (finish.get(a.blocker_id) || 0));
    cur = back[0].blocker_id;
  }
  return {
    lanes,
    totalHours,
    totalDays: Math.ceil(totalHours / 8),
    criticalPath,
  };
}
