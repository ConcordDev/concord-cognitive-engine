// The Agents lens's Run Loop on the cockpit core (CKPT-19). Behind CONCORD_COCKPIT_RUNS; the caller falls back
// to the old loop when this returns null.
import { createRun, getRun, listSteps, tablesReady } from "./run-store.js";
import { planRun, materializePlan } from "./planner.js";
import { driveRun } from "./engine.js";
import { makeExec } from "./executor.js";
import { verifyStep } from "./verifier.js";
import { budgetFromEnv } from "./budget.js";
import { defaultProfile } from "./model-caps.js";
import { publishRun } from "./events.js";

const STATUS_MAP = { done: "completed", failed: "failed", cancelled: "failed", awaiting_confirm: "running" };

export function mapSteps(steps) {
  return steps.map((s) => {
    const ok = s.status === "done";
    const failed = s.status === "failed";
    return {
      index: s.seq, tool: s.tool || "answer", toolKind: s.tool ? "cockpit" : "model", input: s.goal,
      ...(failed ? { error: s.errorText || s.errorClass || "step failed" } : { output: s.resultSummary?.text ?? "" }),
      latencyMs: s.startedAt && s.finishedAt ? Math.max(0, (s.finishedAt - s.startedAt) * (s.finishedAt > 1e12 ? 1 : 1000)) : 0,
      tokens: 0, tokensEstimated: true,
      status: ok ? "ok" : failed ? "error" : s.status,
      ts: new Date().toISOString(),
    };
  });
}

/** @returns {Promise<null | { cockpitRunId: string, status: string, steps: object[] }>} */
export async function runAgentOnCore({ db, userId, goal, allowTools, maxSteps, runMacro, lensActions, deps = {}, deadlineMs = Date.now() + 25000 }) {
  if (!db || !tablesReady(db)) return null;
  const profile = defaultProfile();
  const plan = await (deps.planRun || planRun)({ db, userId, goal, profile, lensActions, deps, allowTools });
  if (!plan.ok) return null;
  const created = createRun(db, { userId, surface: "agents_lens", goal, modelProfile: profile, budget: { ...budgetFromEnv(), maxSteps } });
  if (!created.ok) return null;
  materializePlan(db, created.run.id, 1, plan.steps.slice(0, maxSteps));
  const runId = created.run.id;
  await driveRun({
    db, runId, owner: `agents:${process.pid}`, deadlineMs,
    deps: {
      exec: deps.exec || makeExec({ db, userId, sessionId: null, runMacro, lensActions, surface: "agents_lens" }),
      lensActions, verify: verifyStep, ...(deps.engineDeps || {}),
      emit: (e) => { publishRun(e.runId, e); },
    },
  });
  const run = getRun(db, runId);
  return { cockpitRunId: runId, status: STATUS_MAP[run.status] || "running", steps: mapSteps(listSteps(db, runId)), usage: run.usage };
}
