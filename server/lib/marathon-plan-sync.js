// server/lib/marathon-plan-sync.js
//
// Marathon -> goal-tree write-back (status sync).
//
// Companion to marathon-plan-context.js's read path. When a marathon tick
// is grounded against a linked goal tree, the brain can report genuine
// subgoal completion back with a marker in its final-answer text — same
// convention as the existing `[TASK_COMPLETE]` / `[TASK_BLOCKED: reason]`
// markers agent-marathon.js already parses (see COMPLETE_MARKER /
// BLOCKED_MARKER there). This module detects `[SUBGOAL_COMPLETE: nodeId]`
// and applies it through the EXISTING, already-tested `setNodeStatus` from
// goal-decomposition.js — never a raw DB write, never a parallel status
// column. `setNodeStatus` itself owns the roll-up logic (a node whose every
// live child is done auto-completes, cascading to the tree) — this module
// does not reimplement any of that, it only decides WHEN to call it.
//
// Honest-by-construction: with no linked tree (`treeId` falsy), this is a
// documented no-op (`{ ok:true, applied:[], reason:"no_tree_linked" }`),
// never a silent failure disguised as success.

import { setNodeStatus } from "./goal-decomposition.js";

/** Matches one or more `[SUBGOAL_COMPLETE: <id>]` markers in the brain's
 *  final-answer text. Global so a single answer can check off more than
 *  one subgoal in the same turn (e.g. two small leaves finished together). */
export const SUBGOAL_COMPLETE_MARKER = /\[SUBGOAL_COMPLETE:\s*([^\]]+)\]/gi;

/** Pure extraction — every id returned is a literal, trimmed substring that
 *  actually appeared inside a `[SUBGOAL_COMPLETE: ...]` marker in `text`.
 *  No invention, no guessing at ids the brain didn't actually emit. */
export function findSubgoalCompleteMarkers(text) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(SUBGOAL_COMPLETE_MARKER.source, SUBGOAL_COMPLETE_MARKER.flags);
  let m;
  while ((m = re.exec(text))) {
    const id = String(m[1] || "").trim();
    if (id) out.push(id);
  }
  return out;
}

/**
 * Apply any `[SUBGOAL_COMPLETE: nodeId]` markers found in `answerText` to
 * the linked goal tree, via the real `setNodeStatus` primitive.
 *
 * @param {object} db
 * @param {object} args
 * @param {string|null} [args.treeId] - the linked goal_tree_id, or falsy
 *   when the marathon has no linked plan (honest no-op in that case).
 * @param {string} [args.answerText] - the tick's final brain answer text.
 * @returns {{ ok:boolean, applied:Array<{nodeId,ok,reason?,rolledUp?,treeDone?}>, reason?:string }}
 */
export function applyPlanSync(db, { treeId, answerText } = {}) {
  if (!db) return { ok: false, reason: "no_db", applied: [] };
  if (!treeId) return { ok: true, applied: [], reason: "no_tree_linked" };

  const nodeIds = findSubgoalCompleteMarkers(answerText);
  if (!nodeIds.length) return { ok: true, applied: [], reason: "no_marker" };

  const applied = [];
  for (const nodeId of nodeIds) {
    const res = setNodeStatus(db, { treeId, nodeId, status: "done" });
    applied.push({
      nodeId,
      ok: res.ok,
      reason: res.reason,
      rolledUp: res.rolledUp,
      treeDone: res.treeDone,
    });
  }
  return { ok: true, applied };
}

export default { findSubgoalCompleteMarkers, applyPlanSync, SUBGOAL_COMPLETE_MARKER };
