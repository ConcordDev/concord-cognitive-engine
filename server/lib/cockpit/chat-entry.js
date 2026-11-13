// The chat route's way into the cockpit (CKPT-16). Returns null when the turn is not the cockpit's.
import { decide, runStatusText } from "./router.js";
import { getRun, getStep, listSteps, createRun, countActiveRuns } from "./run-store.js";
import { applyDecision } from "./confirm.js";
import { driveRun } from "./engine.js";
import { materializePlan } from "./planner.js";
import { maxActiveRuns, budgetFromEnv } from "./budget.js";
import { defaultProfile } from "./model-caps.js";
import { publishRun, stepLabel } from "./events.js";
import { makeExec } from "./executor.js";
import { verifyStep } from "./verifier.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";

const reply = (text, cockpit) => ({ handled: true, reply: text, meta: { cockpit } });

function replyFor(run, steps, kind) {
  const done = steps.filter((s) => s.status === "done").length;
  switch (run.status) {
    case "done": {
      const last = [...steps].reverse().find((s) => s.status === "done" && s.resultSummary?.text);
      if (!last) return "Finished, but the last step returned no text.";
      const text = scrubUserFacingToolNames(last.resultSummary.text);
      return steps.length > 1 ? `Finished ${steps.length} steps. ${text}` : text;
    }
    case "awaiting_confirm": {
      const ws = steps.find((s) => s.status === "awaiting_confirm");
      if (run.statusReason === "question" && ws?.errorText) return scrubUserFacingToolNames(ws.errorText);
      return `I need your OK before I continue: ${ws ? stepLabel(ws) : "the next step"}.`;
    }
    case "failed":
      return runStatusText(run, steps);
    default:
      return `Working on it: ${done} of ${steps.length} steps finished. I'll keep going and post the result here.`;
  }
}

/**
 * @param {{ db: object, userId: string, chatSessionId: string|null, message: string, lensContext?: string|null,
 *           surface?: string, prevRoute?: string|null, prevReply?: string, runMacro: Function, lensActions: Map,
 *           chatProgress?: (e:object)=>void, deadlineMs: number, deps?: object }} a
 */
export async function handleChatTurn(a) {
  const profile = defaultProfile();
  const d = await decide(a.message, {
    db: a.db, userId: a.userId, chatSessionId: a.chatSessionId, lensContext: a.lensContext, prevRoute: a.prevRoute,
    prevReply: a.prevReply, profile, lensActions: a.lensActions, deps: a.deps,
  });
  if (d.kind === "answer") {
    return d.statusText ? reply(d.statusText, { runId: null, kind: "status", status: null }) : null;
  }

  const makeDeps = (run) => ({
    exec: makeExec({ db: a.db, userId: a.userId, sessionId: a.chatSessionId, runMacro: a.runMacro, lensActions: a.lensActions, surface: run.surface }),
    lensActions: a.lensActions,
    verify: verifyStep,
    ...(a.deps?.engineDeps || {}),
    emit: (e) => { publishRun(e.runId, e); try { a.chatProgress?.(e); } catch { /* progress never blocks */ } },
  });

  let runId;
  if (d.kind === "resume") {
    const run = getRun(a.db, d.runId);
    const step = getStep(a.db, d.stepId);
    const r = run && step ? applyDecision(a.db, { run, step, userId: a.userId, decision: d.decision, answer: d.answer ?? null, lensActions: a.lensActions }) : { ok: false };
    if (!r.ok) return reply("That step is no longer waiting.", { runId: d.runId, kind: "resume", status: null });
    runId = d.runId;
  } else {
    const active = countActiveRuns(a.db, a.userId);
    if (active >= maxActiveRuns()) {
      return reply(`You already have ${active} tasks running. Wait for one to finish or cancel one.`, { runId: null, kind: "refused", status: null });
    }
    const created = createRun(a.db, {
      userId: a.userId, surface: a.surface || "chat", goal: String(a.message).slice(0, 2000),
      chatSessionId: a.chatSessionId, lensContext: a.lensContext || null, modelProfile: profile, budget: budgetFromEnv(),
    });
    if (!created.ok) return null;
    materializePlan(a.db, created.run.id, 1, d.plan.steps);
    runId = created.run.id;
  }

  const run0 = getRun(a.db, runId);
  await driveRun({ db: a.db, runId, owner: `chat:${process.pid}`, deps: makeDeps(run0), deadlineMs: a.deadlineMs });
  const run = getRun(a.db, runId);
  const steps = listSteps(a.db, runId);
  return reply(replyFor(run, steps, d.kind), { runId, kind: d.kind, status: run.status });
}
