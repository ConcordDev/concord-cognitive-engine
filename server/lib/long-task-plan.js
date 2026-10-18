// server/lib/long-task-plan.js
//
// Plan scaffolding for long tasks (lib/long-task.js). When a background job
// starts, one narrowly-scoped brain call breaks the goal into ordered
// subgoals; they become a durable goal tree (goal-decomposition.js), a project
// linked to the marathon (project-thread.js) so every tick runs with
// marathon-plan-context / plan-sync / replanner, and a dated plan
// (long-horizon-planner.js). Planning jobs also get one calendar task per
// milestone, and time blocks on the user's Concord calendar when they asked
// for them. Nothing here invents progress: if the brain call fails the job
// runs unplanned and the meta says why.

import { getMarathon } from "./agent-marathon.js";
import { createGoalTree, addSubgoals, getGoalTree, nextActionable } from "./goal-decomposition.js";
import { createProject, linkMarathonToProject } from "./project-thread.js";
import { draftPlan } from "./long-horizon-planner.js";

const MAX_SUBGOALS = 8;
const DAY = 86400;

/** "2-week build" → 14, "in 3 days" → 3, "a month" → 30; null when unstated. */
export function parseHorizonDays(text) {
  const p = String(text || "").toLowerCase();
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, couple: 2, few: 3 };
  const m = p.match(/\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|ten|couple(?: of)?|few)[- ](day|week|month)s?\b/);
  if (!m) return null;
  const n = Number(m[1]) || words[m[1].replace(/ of$/, "")] || 1;
  const unit = m[2] === "day" ? 1 : m[2] === "week" ? 7 : 30;
  return Math.min(Math.max(n * unit, 1), 365);
}

/** True when the user asked for time on their calendar, not just a plan. */
export function wantsTimeBlocks(text) {
  return /\b(?:time[- ]?block|block (?:out )?(?:time|my calendar)|(?:put|add|schedule) (?:it|them|this|these|the (?:steps|tasks|plan))? ?(?:on|in|to) (?:my )?calendar|calendar (?:blocks|events))\b/i.test(String(text || ""));
}

function extractJson(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/** Parse the brain's reply into [{title, detail, estimateHours}] (JSON, else a numbered/bulleted list). */
export function parseSubgoals(text) {
  const j = extractJson(text);
  let items = [];
  if (j && Array.isArray(j.subgoals)) {
    items = j.subgoals.map((s) => (typeof s === "string" ? { title: s } : s)).filter((s) => s && typeof s.title === "string");
  } else {
    for (const line of String(text || "").split("\n")) {
      const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.{4,160})$/);
      if (m) items.push({ title: m[1] });
    }
  }
  const seen = new Set();
  return items
    .map((s) => ({
      title: String(s.title).replace(/\*\*/g, "").trim().slice(0, 160),
      ...(typeof s.detail === "string" && s.detail.trim() ? { detail: s.detail.trim().slice(0, 400) } : {}),
      estimateHours: Math.min(Math.max(Number(s.estimateHours) || 2, 0.5), 40),
    }))
    .filter((s) => s.title.length >= 4 && !seen.has(s.title.toLowerCase()) && seen.add(s.title.toLowerCase()))
    .slice(0, MAX_SUBGOALS);
}

function decompositionPrompt(goal, horizonDays) {
  return [
    "You break a goal into a short, ordered list of concrete subgoals that a person or an agent can finish one by one.",
    `Goal: ${goal}`,
    horizonDays ? `Time available: ${horizonDays} days.` : "",
    `Return 4 to ${MAX_SUBGOALS} subgoals in the order they should be done. Each title starts with a verb and names a real deliverable. Give each an honest effort estimate in hours.`,
    'Reply with JSON only, no prose: {"subgoals":[{"title":"...","detail":"one sentence","estimateHours":3}]}',
  ].filter(Boolean).join("\n");
}

function readMeta(db, jobId) {
  try { return JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id = ?`).get(jobId)?.meta_json || "{}") || {}; } catch { return {}; }
}
function mergeMeta(db, jobId, patch) {
  const meta = { ...readMeta(db, jobId), ...patch };
  try { db.prepare(`UPDATE agent_marathon_sessions SET meta_json = ? WHERE id = ?`).run(JSON.stringify(meta), jobId); } catch { /* best-effort */ }
  return meta;
}

function dueIso(ts) { return new Date(ts * 1000).toISOString(); }

/**
 * Decompose a long task's goal once. Idempotent via meta.planAttemptedAt.
 * @returns {Promise<{ok:boolean, reason?:string, goalTreeId?:string, projectId?:string, planId?:string, subgoals?:Array, tasks?:number, timeBlocks?:number}>}
 */
export async function planLongTask(db, { jobId, brain = null, lensActions = null, slot = "conscious", force = false } = {}) {
  if (!db || !jobId) return { ok: false, reason: "missing_inputs" };
  const session = getMarathon(db, jobId);
  if (!session) return { ok: false, reason: "job_not_found" };
  const meta = readMeta(db, jobId);
  if (!meta.longTask) return { ok: false, reason: "not_a_long_task" };
  if (meta.planAttemptedAt && !force) return { ok: true, skipped: true, goalTreeId: meta.goalTreeId || null, projectId: meta.projectId || null };
  mergeMeta(db, jobId, { planAttemptedAt: Date.now() });

  const goal = String(session.goal || session.title || "").slice(0, 1500);
  const horizonDays = parseHorizonDays(goal) || (meta.mode === "plan" ? 14 : null);

  let brainFn = brain;
  if (typeof brainFn !== "function") {
    // Planner slot: the user's own/High Power model, CONCORD_PLANNER_MODEL, else conscious.
    try { ({ plannerBrainChat: brainFn } = await import("./byo-router.js")); } catch { brainFn = null; }
  }
  if (!brainFn) { mergeMeta(db, jobId, { planError: "no_brain" }); return { ok: false, reason: "no_brain" }; }

  let subgoals = [];
  for (let attempt = 0; attempt < 2 && subgoals.length < 2; attempt++) {
    try {
      const r = await brainFn({
        db, userId: session.user_id, slot,
        messages: [{ role: "system", content: decompositionPrompt(goal, horizonDays) }, { role: "user", content: goal }],
        opts: { temperature: 0.2, maxTokens: 900 },
      });
      if (r?.ok) subgoals = parseSubgoals(r.text);
    } catch { /* retry once */ }
  }
  if (subgoals.length < 2) { mergeMeta(db, jobId, { planError: "decomposition_failed" }); return { ok: false, reason: "decomposition_failed" }; }

  const title = String(session.title || goal).slice(0, 120);
  const tree = createGoalTree(db, { userId: session.user_id, title, description: goal });
  if (!tree.ok) { mergeMeta(db, jobId, { planError: tree.reason }); return { ok: false, reason: tree.reason }; }
  const added = addSubgoals(db, { treeId: tree.treeId, parentId: tree.rootId, subgoals: subgoals.map((s) => ({ title: s.title, ...(s.detail ? { detail: s.detail } : {}) })) });

  let projectId = null;
  const proj = createProject(db, session.user_id, title, { goalTreeId: tree.treeId });
  if (proj.ok) {
    projectId = proj.project?.id || null;
    if (projectId) linkMarathonToProject(db, projectId, jobId);
  }

  let planId = null;
  let milestones = [];
  if (horizonDays) {
    const plan = draftPlan(db, { userId: session.user_id, treeId: tree.treeId, title, horizonDays });
    if (plan.ok) { planId = plan.planId; milestones = plan.milestones; }
  }

  // Calendar tasks (planning jobs) and time blocks (only when asked).
  const taskIds = [];
  let timeBlocks = 0;
  const createTask = lensActions?.get?.("calendar.tasks-create");
  const blockTask = lensActions?.get?.("calendar.tasks-time-block");
  if (meta.mode === "plan" && typeof createTask === "function" && milestones.length) {
    const ctx = { actor: { userId: session.user_id }, userId: session.user_id, db };
    const block = wantsTimeBlocks(goal) && typeof blockTask === "function";
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const sg = subgoals.find((s) => s.title === m.title) || subgoals[i] || {};
      try {
        const r = await createTask(ctx, {}, {
          title: m.title, dueAt: dueIso(m.dueTs), estimateMin: Math.round((sg.estimateHours || 2) * 60),
          notes: `From background job ${jobId} (${title}).${sg.detail ? " " + sg.detail : ""}`, priority: "medium",
        });
        const task = r?.result?.task;
        if (task?.id) {
          taskIds.push(task.id);
          if (block) {
            const start = new Date((m.dueTs - DAY) * 1000);
            start.setHours(10, 0, 0, 0);
            const b = await blockTask(ctx, {}, { taskId: task.id, start: start.toISOString() });
            if (b?.ok) timeBlocks++;
          }
        }
      } catch { /* one bad task doesn't stop the rest */ }
    }
  }

  mergeMeta(db, jobId, {
    goalTreeId: tree.treeId, ...(projectId ? { projectId } : {}), ...(planId ? { planId } : {}),
    ...(horizonDays ? { horizonDays } : {}), subgoalCount: added?.nodes?.length || subgoals.length,
    ...(taskIds.length ? { taskIds } : {}), ...(timeBlocks ? { timeBlocks } : {}), planError: undefined,
  });
  return { ok: true, goalTreeId: tree.treeId, projectId, planId, subgoals, milestones, tasks: taskIds.length, timeBlocks };
}

/** Short plan summary for status replies: progress and the next subgoals. */
export function planSummary(db, meta) {
  if (!db || !meta?.goalTreeId) return null;
  const gt = getGoalTree(db, meta.goalTreeId);
  if (!gt?.ok) return null;
  const next = nextActionable(db, meta.goalTreeId, 3).map((n) => n.title);
  let milestones = [];
  if (meta.planId) {
    try {
      milestones = db.prepare(`SELECT title, due_ts AS dueTs, status FROM lh_milestones WHERE plan_id = ? ORDER BY ordinal`).all(meta.planId);
    } catch { milestones = []; }
  }
  return { done: gt.done, total: gt.total, next, milestones, tasks: Array.isArray(meta.taskIds) ? meta.taskIds.length : 0, timeBlocks: meta.timeBlocks || 0 };
}

export default { parseHorizonDays, wantsTimeBlocks, parseSubgoals, planLongTask, planSummary };
