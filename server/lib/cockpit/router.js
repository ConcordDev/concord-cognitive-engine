// Decide, for each chat turn: answer, one call, a run, or the answer to a waiting run (CKPT-16).
import { isBareAffirmation, chatAgentRoute } from "../chat/agent-route.js";
import { isLongTaskAsk } from "../long-task.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { cockpitFlag } from "./flags.js";
import { tablesReady, findWaitingRun, listRunsForUser, listSteps } from "./run-store.js";
import { planRun } from "./planner.js";
import { stepLabel } from "./events.js";

export const REJECT_WORDS = Object.freeze(["no", "nope", "cancel", "stop", "don't", "dont", "no thanks"]);
export const STATUS_ASKS = Object.freeze(["what happened", "what went wrong", "why did it fail", "why did it stop", "status"]);

/** Plain-language account of a run: what finished, what failed or was skipped and why. */
export function runStatusText(run, steps) {
  const done = steps.filter((s) => s.status === "done").length;
  const bad = steps.filter((s) => s.status === "failed" || s.status === "skipped");
  const head = bad.length ? `${done} of ${steps.length} steps finished.` : `All ${steps.length} steps finished.`;
  const lines = bad.map((s) => scrubUserFacingToolNames(`${stepLabel(s)}: ${s.errorText || (s.status === "skipped" ? "skipped" : "did not finish")}`));
  const shown = lines.slice(0, 12);
  if (lines.length > 12) shown.push(`and ${lines.length - 12} more.`);
  return [head, ...shown].join("\n");
}

/**
 * @returns {Promise<{kind:"answer",statusText?:string}|{kind:"single"|"run",plan:object}|{kind:"resume",runId:string,stepId:string,decision:string,answer?:string}>}
 */
export async function decide(message, ctx) {
  const answer = { kind: "answer" };
  const { db, userId, chatSessionId } = ctx;
  if (!cockpitFlag("ROUTE") || !cockpitFlag("RUNS") || !userId || !db || !tablesReady(db)) return answer;
  const msg = String(message || "");
  const norm = msg.toLowerCase().trim().replace(/[.!?]+$/, "");

  const waiting = chatSessionId ? findWaitingRun(db, userId, chatSessionId) : null;
  if (waiting) {
    const ws = listSteps(db, waiting.id).find((s) => s.status === "awaiting_confirm");
    if (ws) {
      const reason = waiting.statusReason;
      const base = { kind: "resume", runId: waiting.id, stepId: ws.id };
      if (reason === "confirm" && isBareAffirmation(msg)) return { ...base, decision: "approve" };
      if (REJECT_WORDS.includes(norm)) return { ...base, decision: "reject" };
      if (reason === "question" || reason === "needs_help") return { ...base, decision: "answer", answer: msg };
      // Anything else: the run stays waiting and the turn is handled as a new message.
    }
  }

  if (STATUS_ASKS.includes(norm)) {
    const run = listRunsForUser(db, userId, { limit: 5 }).find((r) => r.chatSessionId && r.chatSessionId === chatSessionId);
    if (run) return { kind: "answer", statusText: runStatusText(run, listSteps(db, run.id)) };
  }

  if (!isLongTaskAsk(msg) && !chatAgentRoute(msg, { prevRoute: ctx.prevRoute, prevReply: ctx.prevReply })) return answer;

  const plan = await (ctx.deps?.planRun || planRun)({
    db, userId, goal: msg, lensContext: ctx.lensContext || null, profile: ctx.profile, lensActions: ctx.lensActions,
  });
  if (!plan || plan.ok === false) return answer;
  if (plan.steps.length === 1 && !isLongTaskAsk(msg)) return { kind: "single", plan };
  return { kind: "run", plan };
}
