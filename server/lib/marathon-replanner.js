// server/lib/marathon-replanner.js
//
// Explicit replan checkpoint — the core structural fix.
//
// Gap this closes: without this, a marathon's "plan" lives only as whatever
// the brain infers from a compacted transcript, re-derived from scratch
// every tick, with no mechanism to detect looping on a failed approach or
// force a "step back and reconsider." This module adds that mechanism: a
// DEDICATED brain call (narrowly-scoped prompt, see
// TASK_PROMPTS.marathonReplan in prompt-registry.js) whose only legal
// output is a structured subgoal add/abandon list, applied EXCLUSIVELY
// through the existing, already-tested `addSubgoals` / `setNodeStatus`
// primitives from goal-decomposition.js.
//
// ── PINNED SAFETY INVARIANT ──────────────────────────────────────────────
// A replan can NEVER touch/expand `allowed_domains_json` or `budget_cap` on
// the marathon session. Replanning changes what subgoals exist, never what
// the mandate permits. This is enforced STRUCTURALLY, not by a runtime
// filter: `runReplanCheckpoint` below has no code path that reads
// `allowed_domains_json`/`budget_cap`/`max_turns`/any mandate field off the
// brain's parsed output, and it never issues any UPDATE against
// `agent_marathon_sessions` at all — the only two DB-mutating calls it ever
// makes are `addSubgoals(...)` and `setNodeStatus(...)`, both of which only
// ever touch `goal_trees`/`goal_nodes`. Even a maliciously-crafted brain
// reply containing `allowed_domains_json`/`budget_cap`/etc. keys is
// silently ignored — those keys are simply never read.
// See tests/marathon-replanner.test.js for the pinning test that proves
// this by smuggling exactly such a payload through a scripted brain call.

import { addSubgoals, setNodeStatus, getGoalTree, nextActionable } from "./goal-decomposition.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

/** Marker the brain (in an ordinary tick's final answer) can emit to force
 *  an immediate replan checkpoint on the NEXT eligible check, same style as
 *  agent-marathon.js's existing COMPLETE_MARKER/BLOCKED_MARKER. */
export const REPLAN_MARKER = /\[REPLAN_NEEDED:\s*([^\]]*)\]/i;

/** Absent an explicit marker, force a checkpoint every N cumulative turns
 *  (a coarse "step back and reconsider periodically" cadence). 0 disables
 *  the interval-based trigger entirely (marker-only). */
export const DEFAULT_REPLAN_TURN_INTERVAL = Number(process.env.CONCORD_MARATHON_REPLAN_INTERVAL) || 20;

/** Cap on how many subgoals / abandonments a single checkpoint may apply —
 *  a structural ceiling independent of whatever the brain asks for. */
const MAX_ADD_SUBGOALS = 10;
const MAX_ABANDON_IDS = 20;

/**
 * Decide whether THIS tick should run a replan checkpoint. Pure function —
 * no DB, no brain call — so the trigger logic is unit-testable in isolation
 * from the (comparatively expensive/mockable) brain call itself.
 *
 * @param {object} args
 * @param {string} [args.answerText] - the tick's final brain answer text.
 * @param {number} [args.priorTotalTurns] - session.total_turns BEFORE this tick.
 * @param {number} [args.newTotalTurns] - total_turns AFTER this tick.
 * @param {number} [args.intervalTurns] - override DEFAULT_REPLAN_TURN_INTERVAL.
 * @returns {{ trigger:boolean, reason?:string }}
 */
export function shouldReplan({ answerText, priorTotalTurns, newTotalTurns, intervalTurns = DEFAULT_REPLAN_TURN_INTERVAL } = {}) {
  const markerMatch = REPLAN_MARKER.exec(String(answerText || ""));
  if (markerMatch) {
    const reason = String(markerMatch[1] || "").trim();
    return { trigger: true, reason: reason || "brain_requested" };
  }
  if (
    Number(intervalTurns) > 0 &&
    Number.isFinite(priorTotalTurns) &&
    Number.isFinite(newTotalTurns) &&
    newTotalTurns > 0
  ) {
    const before = Math.floor(priorTotalTurns / intervalTurns);
    const after = Math.floor(newTotalTurns / intervalTurns);
    if (after > before) return { trigger: true, reason: "turn_interval" };
  }
  return { trigger: false };
}

/** Extract the first top-level `{...}` JSON object out of free-form brain
 *  text (the brain is instructed to emit ONLY the JSON, but this tolerates
 *  a stray wrapper/fence without ever inventing content). Returns null on
 *  any parse failure — never throws. */
function extractJsonObject(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Run the dedicated replan brain call and apply its output EXCLUSIVELY
 * through addSubgoals/setNodeStatus. See the module header for the pinned
 * safety invariant this function is built to structurally guarantee.
 *
 * @param {object} db
 * @param {object} args
 * @param {string} args.treeId - the linked goal_tree_id (caller resolves this;
 *   this function never discovers it on its own).
 * @param {string} [args.userId]
 * @param {string} [args.reason] - why the checkpoint fired (from shouldReplan).
 * @param {Function} [args.brain] - injectable brain-call seam (tests); defaults
 *   to the real byo-router.js#brainChat, lazily imported to avoid a hard
 *   dependency for callers that always inject one (mirrors chat-agent.js's
 *   own `opts.brainChat || brainChat` pattern).
 * @param {string} [args.slot]
 * @returns {Promise<{ ok:boolean, reason?:string, added?:object, abandoned?:Array }>}
 */
export async function runReplanCheckpoint(db, { treeId, userId, reason, brain, slot = "conscious" } = {}) {
  if (!db || !treeId) return { ok: false, reason: "missing_inputs" };

  const gt = getGoalTree(db, treeId);
  if (!gt.ok) return { ok: false, reason: gt.reason || "goal_tree_unavailable" };

  const actionable = nextActionable(db, treeId, 10);
  const actionableText = actionable.length
    ? actionable.map((a) => `[${a.id}] ${a.title} (${a.status})`).join("\n")
    : "(none)";

  const prompt = TASK_PROMPTS.marathonReplan({
    goalTitle: gt.tree.title,
    progress: gt.progress,
    actionable: actionableText,
    reason,
  });

  let brainFn = brain;
  if (typeof brainFn !== "function") {
    try {
      ({ brainChat: brainFn } = await import("./byo-router.js"));
    } catch {
      return { ok: false, reason: "no_brain_available" };
    }
  }

  let r;
  try {
    r = await brainFn({
      db, userId,
      slot,
      messages: [{ role: "system", content: prompt }],
      opts: { temperature: 0.2, maxTokens: 800 },
    });
  } catch (e) {
    return { ok: false, reason: "brain_error", error: String(e?.message || e) };
  }
  if (!r || !r.ok) return { ok: false, reason: "brain_failed" };

  const parsed = extractJsonObject(r.text);
  if (!parsed) return { ok: false, reason: "unparseable_output", raw: r.text };

  // Hard allowlist by construction: these are the ONLY two properties this
  // function ever reads off `parsed`. Anything else present on `parsed`
  // (including allowed_domains_json / budget_cap / max_turns / any other
  // mandate-shaped key an adversarial or confused brain reply might smuggle
  // in) is never referenced anywhere below, and this function never touches
  // `agent_marathon_sessions` at all — so such keys have zero effect.
  const rawAdd = Array.isArray(parsed.addSubgoals) ? parsed.addSubgoals : [];
  const rawAbandon = Array.isArray(parsed.abandonNodeIds) ? parsed.abandonNodeIds : [];

  const subgoals = rawAdd
    .map((s) => {
      if (typeof s === "string") return s.trim() ? { title: s.trim() } : null;
      if (s && typeof s.title === "string" && s.title.trim()) {
        return { title: s.title.trim(), ...(typeof s.detail === "string" ? { detail: s.detail } : {}) };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, MAX_ADD_SUBGOALS);

  const abandonIds = rawAbandon
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim())
    .slice(0, MAX_ABANDON_IDS);

  const rootId = gt.tree.root?.id;
  const added = (subgoals.length && rootId)
    ? addSubgoals(db, { treeId, parentId: rootId, subgoals })
    : { ok: true, nodes: [] };

  const abandoned = [];
  for (const nodeId of abandonIds) {
    const res = setNodeStatus(db, { treeId, nodeId, status: "abandoned" });
    abandoned.push({ nodeId, ok: res.ok, reason: res.reason });
  }

  return { ok: true, added, abandoned, reasonForReplan: reason || null };
}

export default { shouldReplan, runReplanCheckpoint, REPLAN_MARKER, DEFAULT_REPLAN_TURN_INTERVAL };
