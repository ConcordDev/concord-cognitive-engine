// server/lib/long-task-finish.js
//
// Plan and research long tasks always end with their deliverable. When about
// FINISH_TURNS_LEFT turns remain (or, for a plan job, every subgoal is done)
// the next tick skips the tool loop and makes one planner-slot call that
// writes the final dated plan / report from everything gathered so far. The
// tick then marks the job completed, which creates the document
// (research-mode.js#createResearchReport) and posts it back.

export const FINISH_TURNS_LEFT = Number(process.env.CONCORD_LONG_TASK_FINISH_AT) || 6;
const FINISH_MODES = new Set(["plan", "research"]);

/** True when the tree has subgoals and every one is done (or dropped). */
export function subgoalsAllDone(db, treeId) {
  if (!db || !treeId) return false;
  try {
    const rows = db.prepare(`SELECT status FROM goal_nodes WHERE tree_id = ? AND parent_id IS NOT NULL`).all(treeId);
    return rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "abandoned");
  } catch { return false; }
}

/** Why this tick should write the final deliverable, or null. */
export function shouldFinish(db, session, meta) {
  if (!session || !meta?.longTask || !FINISH_MODES.has(meta.mode)) return null;
  if ((Number(meta.finalStepFailures) || 0) >= 2) return null;
  const left = (Number(session.max_turns) || 0) - (Number(session.total_turns) || 0);
  if (left <= FINISH_TURNS_LEFT) return "turns_left";
  if (meta.mode === "plan" && subgoalsAllDone(db, meta.goalTreeId)) return "subgoals_done";
  return null;
}

/** The instruction for the final write-up turn. */
export function finalStepPrompt(meta, { planText = "", today = new Date() } = {}) {
  const day = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  if (meta?.mode === "plan") {
    return [
      `FINAL STEP. Today is ${day}. Stop researching and write the finished plan now, in full. No tool calls.`,
      planText ? `The dated milestones already on the plan:\n${planText}` : "",
      "Write it as a markdown document with these sections:",
      "1. Goal and assumptions (one short paragraph).",
      "2. Day-by-day schedule: one line per day with the real calendar date (for example 'Mon Oct 19: ...'), covering the whole time frame, matching the milestones above.",
      "3. Parts and tools list with quantities and approximate prices (say 'approx.' where you're estimating).",
      "4. Checkpoints: what must work at the end of each milestone.",
      "5. Risks and fallbacks.",
      "Use what the earlier turns found; where you didn't verify something, say it's an estimate. Don't mention files, PDFs, music, models or anything else unless a tool in this job actually created it. Don't write progress notes: write the plan itself. End with [TASK_COMPLETE].",
    ].filter(Boolean).join("\n");
  }
  return [
    `FINAL STEP. Today is ${day}. Stop searching and write the final research report now, in full. No tool calls.`,
    "Markdown: a short answer up front, then a comparison (a table works), then details and a recommendation.",
    "Only state numbers (specs, prices) that appeared in the pages you actually read; if you're unsure of a number, leave it out or say it's unverified. Cite the source URLs you read.",
    "End with [TASK_COMPLETE].",
  ].join("\n");
}

/** Strip loop markers and stray tool calls from the write-up, then mark complete. */
export function finalizeText(text) {
  const t = String(text || "")
    .replace(/\[TOOL_CALL:[\s\S]*?\]\s*$/gm, "")
    .replace(/\[TASK_BLOCKED:[^\]]*\]/gi, "")
    .replace(/\[TASK_COMPLETE\]/gi, "")
    .trim();
  return t ? `${t}\n\n[TASK_COMPLETE]` : "";
}

export default { FINISH_TURNS_LEFT, subgoalsAllDone, shouldFinish, finalStepPrompt, finalizeText };
