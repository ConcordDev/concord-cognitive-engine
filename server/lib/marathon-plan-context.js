// server/lib/marathon-plan-context.js
//
// Marathon <-> goal-tree plan-grounding (READ path only, no new autonomy).
//
// Gap this closes: agent-marathon.js#tickMarathon and goal-decomposition.js
// (durable goal_tree/goal_nodes, migration 340) are two well-tested
// subsystems joined ONLY by project-thread.js's inert bookkeeping join
// table (migration 378 `projects` / `project_marathon_links`) — a marathon
// never actually READ `nextActionable()` to decide what to do next. This
// module is the read-side fix: given a `projectId` a marathon tick was
// explicitly told about (opt-in, never auto-discovered), pull the linked
// goal tree's REAL current state straight from goal-decomposition.js's own
// getters and render it as grounded prompt text — every line is a literal
// field off a live DB row, nothing inferred or invented.
//
// This module does NOT decide anything and does NOT write anything. It has
// no side effects on the goal tree, the marathon session, or the mandate
// envelope (allowed_domains_json / budget_cap) — those live entirely
// outside this file's reach. Write-back is a SEPARATE, explicitly-marked
// concern (see marathon-plan-sync.js for status roll-up and
// marathon-replanner.js for structural replanning).

import { getGoalTree, nextActionable } from "./goal-decomposition.js";

/** How many next-actionable subgoals to surface in the prompt. Kept small —
 *  this is grounding context, not the whole tree dump. */
const MAX_ACTIONABLE_IN_PROMPT = 5;

/**
 * Resolve the goal_tree_id a project points at, straight off the `projects`
 * row (migration 378). Returns null (never throws) when the project doesn't
 * exist, has no linked tree, or the table is absent (pre-378 schema) — this
 * mirrors the honest-null convention every other reader in this codebase
 * uses for a dangling/optional FK.
 */
export function getLinkedGoalTreeId(db, projectId) {
  if (!db || !projectId) return null;
  try {
    const row = db.prepare(`SELECT goal_tree_id AS goalTreeId FROM projects WHERE id = ?`).get(projectId);
    return row?.goalTreeId || null;
  } catch {
    return null;
  }
}

/**
 * Render the real tree state (title, progress, next-actionable subgoals)
 * as a plain-text prompt block. Every line is a literal field off `gt`/
 * `actionable` — no invented content, no LLM call.
 */
function renderPlanContextBlock(gt, actionable) {
  const donePct = Math.round((gt.progress || 0) * 100);
  const lines = [
    "",
    "",
    `--- Linked project plan (goal tree: "${gt.tree.title}") ---`,
    `Progress: ${gt.done}/${gt.total} subgoal(s) done (${donePct}%).`,
  ];
  if (actionable.length > 0) {
    lines.push("Next actionable subgoals (no open children of their own — these are what to actually work on next):");
    for (const a of actionable) lines.push(`- [${a.id}] ${a.title} (status: ${a.status})`);
    lines.push(
      "When you have GENUINELY and FULLY completed one of the subgoals above, say so and include " +
      "the exact marker [SUBGOAL_COMPLETE: <id>] (using the bracketed id shown above) in your final " +
      "answer, so the plan tree reflects real progress. Never emit this marker for a subgoal you have " +
      "not actually finished."
    );
  } else {
    lines.push("No open actionable subgoals remain right now — the tree may be fully done, or waiting on further decomposition.");
  }
  lines.push("--- end plan context ---");
  return lines.join("\n");
}

/**
 * Build the plan-grounding context for a marathon tick.
 *
 * @param {object} db
 * @param {string} projectId
 * @returns {{ ok:boolean, reason?:string, goalTreeId?:string, progress?:number,
 *   total?:number, done?:number, actionable?:Array, block:string }}
 *   `block` is always a string (empty on any non-ok path) so a caller can
 *   unconditionally concatenate it without an extra null-check.
 */
export function buildPlanContextBlock(db, projectId) {
  if (!db || !projectId) return { ok: false, reason: "missing_inputs", block: "" };

  const goalTreeId = getLinkedGoalTreeId(db, projectId);
  if (!goalTreeId) return { ok: false, reason: "no_goal_tree_linked", block: "" };

  const gt = getGoalTree(db, goalTreeId);
  if (!gt.ok) return { ok: false, reason: gt.reason || "goal_tree_unavailable", goalTreeId, block: "" };

  const actionable = nextActionable(db, goalTreeId, MAX_ACTIONABLE_IN_PROMPT);
  const block = renderPlanContextBlock(gt, actionable);

  return {
    ok: true,
    goalTreeId,
    progress: gt.progress,
    total: gt.total,
    done: gt.done,
    actionable,
    block,
  };
}

export default { getLinkedGoalTreeId, buildPlanContextBlock };
