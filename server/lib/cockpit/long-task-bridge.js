// start_long_task on the cockpit core (CKPT-20). The pump drives the run; a finished run posts its text back.
import { createRun, countActiveRuns, tablesReady } from "./run-store.js";
import { planRun, materializePlan } from "./planner.js";
import { maxActiveRuns, budgetFromEnv } from "./budget.js";
import { defaultProfile } from "./model-caps.js";
import { replyFor } from "./chat-entry.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { enqueueLongTaskNotice } from "../long-task.js";

/**
 * @returns {Promise<{ ok: boolean, runId?: string, total?: number, message?: string, reason?: string }>}
 */
export async function startCockpitLongTask(a) {
  const { db, userId } = a;
  if (!db || !userId || !tablesReady(db)) return { ok: false, reason: "unavailable" };
  const goal = String(a.goal || "").trim();
  if (goal.length < 8) return { ok: false, reason: "goal_too_short" };
  if (countActiveRuns(db, userId) >= maxActiveRuns()) return { ok: false, reason: "too_many_runs" };
  const profile = defaultProfile();
  const plan = await (a.deps?.planRun || planRun)({ db, userId, goal, profile, lensActions: a.lensActions || new Map(), deps: a.deps });
  if (!plan?.ok || !plan.steps?.length) return { ok: false, reason: plan?.reason || "plan_failed" };
  const surface = a.surface || "long_task";
  const created = createRun(db, { userId, surface, goal, chatSessionId: a.chatSessionId || null, modelProfile: profile, budget: budgetFromEnv() });
  if (!created.ok) return { ok: false, reason: created.reason || "create_failed" };
  materializePlan(db, created.run.id, 1, plan.steps);
  const total = plan.steps.length;
  return { ok: true, runId: created.run.id, total, message: `Started. ${total} step${total === 1 ? "" : "s"}. I'll post the result here when it's done.` };
}

/** Called by the engine when a long_task run reaches a terminal status. Never throws. */
export async function deliverRunResult(db, run, steps) {
  try {
    if (!run || run.surface !== "long_task") return { ok: false, reason: "not_long_task" };
    const text = scrubUserFacingToolNames(replyFor(run, steps, "run"));
    return await enqueueLongTaskNotice(db, { userId: run.userId, surface: run.chatSessionId ? "chat" : "agent", sessionId: run.chatSessionId, text, runId: run.id });
  } catch { return { ok: false, reason: "deliver_failed" }; }
}
