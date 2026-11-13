// The run state machine (CKPT-09). Orchestration is deterministic: the next
// action comes only from the rows in cockpit_runs / cockpit_steps. Model calls
// and tool calls are the only non-deterministic activities, and each one is
// written to the store before the cursor moves.
import { canonicalJson } from "../receipts/attest.js";
import { acquireLease, releaseLease, getRun, listSteps, updateRun, updateStep, addUsage, getApprovals } from "./run-store.js";
import { getToolSpec } from "./tool-spec.js";
import { validateAndRepair } from "./validate-repair.js";
import { buildToolMenu } from "./tool-menu.js";
import { buildContextPacket } from "./context-packet.js";
import { requestStepCall } from "./step-llm.js";
import { summarizeResult } from "./result-summary.js";
import { nextAction } from "./retry-policy.js";
import { runTool } from "./executor.js";
import { getEffect, failEffect } from "./idempotency.js";
import { needsConfirm, buildConfirmCard } from "./confirm.js";
import { checkBudget, retryAfterSec } from "./budget.js";
import { makeStepReceipt } from "./receipts.js";
import { effectiveSpec } from "./tool-spec.js";

// CKPT-20: a finished long_task run posts its result back to the thread. Never throws, never blocks the tick.
function notifyTerminal(db, runId) {
  try {
    const run = getRun(db, runId);
    if (!run || run.surface !== "long_task") return;
    void import("./long-task-bridge.js").then((m) => m.deliverRunResult(db, run, listSteps(db, runId))).catch(() => {});
  } catch { /* delivery is best-effort */ }
}

const TERMINAL_RUN = new Set(["done", "failed", "cancelled"]);
const TERMINAL_STEP = new Set(["done", "skipped", "failed"]);
const REASK_CLASSES = new Set(["bad_args", "verify_failed", "fake_success", "looped", "not_found", "unknown_tool"]);

export const NEXT_PROFILE = Object.freeze({ "local-2b": "local-9b", "local-9b": "local-30b" });
export const nextProfile = (p) => NEXT_PROFILE[p] || p;

export function runProgress(steps) {
  const c = { done: 0, total: steps.length, failed: 0, skipped: 0 };
  for (const s of steps) {
    if (s.status === "done") c.done += 1;
    else if (s.status === "failed") c.failed += 1;
    else if (s.status === "skipped") c.skipped += 1;
  }
  return c;
}

function walkPath(obj, path) {
  let cur = obj;
  for (const part of String(path).split(".").filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Resolve {"$ref":"stp_x.result.a.b"} and {"$ref":"stp_x.values.key"} against done steps. */
export function resolveRefs(args, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const resolve = (v) => {
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$ref" && typeof v.$ref === "string") {
        const m = /^([^.]+)\.(result|values)\.?(.*)$/.exec(v.$ref);
        if (!m) return undefined;
        const st = byId.get(m[1]);
        if (!st || st.status !== "done") return undefined;
        const root = m[2] === "result" ? st.result : st.resultSummary?.values;
        return m[3] ? walkPath(root, m[3]) : root;
      }
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const r = resolve(val);
        if (r !== undefined) out[k] = r;
      }
      return out;
    }
    return v;
  };
  return args === null || args === undefined ? args : resolve(args);
}

/**
 * Advance a run by at most one step.
 * @returns {Promise<{ ok: boolean, status: string, advanced: boolean, reason?: string }>}
 */
export async function tickRun(a) {
  const { db, runId, owner } = a;
  const deps = a.deps || {};
  const nowMs = () => (deps.now ? deps.now() : Date.now());
  const nowSec = () => Math.floor(nowMs() / 1000);
  const sleep = deps.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const emit = (e) => { try { (deps.emit || (() => {}))(e); } catch { /* listeners never break a run */ } };
  const stepCall = deps.stepCall || requestStepCall;
  const verify = deps.verify || (async () => ({ pass: true, checks: [] }));
  const getSpec = (id) => getToolSpec(id, { lensActions: deps.lensActions });

  let run = getRun(db, runId);
  if (!run) return { ok: false, status: "not_found", advanced: false, reason: "not_found" };
  if (TERMINAL_RUN.has(run.status) || run.status === "awaiting_confirm") return { ok: true, status: run.status, advanced: false };
  if (run.status === "paused" && (run.resumeAt === null || run.resumeAt === undefined || run.resumeAt > nowSec())) {
    return { ok: true, status: run.status, advanced: false };
  }
  if (!acquireLease(db, runId, owner, 90, nowSec())) return { ok: true, status: run.status, advanced: false, reason: "leased" };

  try {
    if (run.status === "planned" || run.status === "paused") {
      updateRun(db, runId, { status: "running", statusReason: null, resumeAt: null });
      run = getRun(db, runId);
      emit({ type: "cockpit:run", runId, status: "running" });
    }
    let steps = listSteps(db, runId);
    const budget = checkBudget(run, steps, nowMs());
    if (!budget.ok) {
      const reason = `budget:${budget.reason}`;
      updateRun(db, runId, { status: "paused", statusReason: reason, resumeAt: null });
      emit({ type: "cockpit:run", runId, status: "paused", reason });
      return { ok: true, status: "paused", advanced: false, reason };
    }

    const byId = new Map(steps.map((s) => [s.id, s]));
    let step = null;
    for (const s of steps) {
      if (TERMINAL_STEP.has(s.status)) continue;
      const depStates = s.dependsOn.map((id) => byId.get(id)?.status);
      if (depStates.includes("failed")) {
        updateStep(db, s.id, { status: "skipped", errorClass: "dependency_failed", finishedAt: nowSec() });
        emit({ type: "cockpit:step", runId, seq: s.seq, total: steps.length, status: "skipped", label: s.goal });
        return { ok: true, status: "running", advanced: true };
      }
      if (depStates.every((st) => st === "done" || st === "skipped")) { step = s; break; }
    }
    if (!step) {
      const required = steps.filter((s) => s.required);
      if (required.every((s) => s.status === "done")) {
        updateRun(db, runId, { status: "done", finishedAt: nowSec() });
        emit({ type: "cockpit:run", runId, status: "done", ...runProgress(steps) });
        notifyTerminal(db, runId);
        return { ok: true, status: "done", advanced: false };
      }
      updateRun(db, runId, { status: "failed", statusReason: "required_step_failed", finishedAt: nowSec() });
      emit({ type: "cockpit:run", runId, status: "failed", ...runProgress(steps) });
      notifyTerminal(db, runId);
      return { ok: true, status: "failed", advanced: false, reason: "required_step_failed" };
    }

    updateRun(db, runId, { cursor: step.seq });
    let attempt = step.attempts;
    if (step.status === "pending" || step.status === "ready") {
      attempt = step.attempts + 1;
      updateStep(db, step.id, { status: "running", startedAt: nowSec(), attempts: attempt });
    }
    // Resume branch: the step was `running` when loaded, so a previous process died or timed out.
    let resumed = null;
    if (step.status === "running" && step.idempotencyKey) {
      const eff = getEffect(db, step.idempotencyKey);
      if (eff?.status === "completed" && eff.result) {
        resumed = eff;
      } else if (eff && (eff.status === "claimed" || eff.status === "unknown")) {
        const sp = effectiveSpec({ tool: eff.tool, args: step.args || {} }, { lensActions: deps.lensActions });
        if (sp?.idempotent === true) {
          failEffect(db, step.idempotencyKey);
        } else {
          updateStep(db, step.id, { status: "awaiting_confirm", errorClass: "in_flight", errorText: "This step may already have happened." });
          updateRun(db, runId, { status: "awaiting_confirm", statusReason: "maybe_done" });
          emit({ type: "cockpit:confirm", runId, stepId: step.id, kind: "maybe_done", label: step.goal, message: "This step may already have happened." });
          return { ok: true, status: "awaiting_confirm", advanced: false };
        }
      }
    }
    const total = steps.length;
    const tried = step.repairs.filter((r) => r.kind === "tried").map((r) => r.tool);
    const repairs = [...step.repairs];
    const prior = steps.filter((s) => s.status === "done").sort((x, y) => y.seq - x.seq).map((s) => ({ values: s.resultSummary?.values || {} }));

    let lastRaw = null;
    const failStep = async (errorClass, errorText, failedTool) => {
      const spec = failedTool ? getSpec(failedTool) : (step.tool ? getSpec(step.tool) : null);
      let action = nextAction({ errorClass, attempt, required: step.required, spec, triedTools: [...tried, ...(failedTool ? [failedTool] : [])] });
      // A write may have partly happened: never re-run a non-idempotent tool in place.
      if (action.kind === "retry" && spec && spec.idempotent === false) action = step.required ? { kind: "ask_user" } : { kind: "skip" };
      // A failed optional step is skipped, not escalated (its permission problems still reach the person).
      if (action.kind === "ask_user" && !step.required && errorClass !== "scope_denied") action = { kind: "skip" };
      const base = { errorClass, errorText: errorText ? String(errorText).slice(0, 400) : null, repairs };
      switch (action.kind) {
        case "repair": case "reask": case "retry": case "slot_change":
          updateStep(db, step.id, { status: "ready", ...base });
          if (action.kind === "retry" && action.delayMs) await sleep(action.delayMs);
          if (action.kind === "slot_change") updateRun(db, runId, { modelProfile: nextProfile(run.modelProfile) });
          return { ok: true, status: "running", advanced: true };
        case "fallback_tool":
          if (failedTool) repairs.push({ kind: "tried", tool: failedTool });
          updateStep(db, step.id, { status: "ready", fallbackTool: action.tool, ...base });
          return { ok: true, status: "running", advanced: true };
        case "ask_user":
          updateStep(db, step.id, { status: "awaiting_confirm", ...base });
          updateRun(db, runId, { status: "awaiting_confirm", statusReason: "needs_help" });
          emit({ type: "cockpit:confirm", runId, stepId: step.id, kind: "help", label: step.goal, message: base.errorText });
          return { ok: true, status: "awaiting_confirm", advanced: false };
        case "pause":
          updateStep(db, step.id, { status: "ready", ...base });
          updateRun(db, runId, { status: "paused", statusReason: "rate_limited", resumeAt: nowSec() + retryAfterSec(lastRaw) });
          emit({ type: "cockpit:run", runId, status: "paused", reason: "rate_limited" });
          return { ok: true, status: "paused", advanced: false };
        case "skip":
          updateStep(db, step.id, { status: "skipped", finishedAt: nowSec(), ...base });
          emit({ type: "cockpit:step", runId, seq: step.seq, total, status: "skipped", label: step.goal });
          return { ok: true, status: "running", advanced: true };
        case "fail_step":
          updateStep(db, step.id, { status: "failed", finishedAt: nowSec(), ...base });
          return { ok: true, status: "running", advanced: true };
        case "stop_run":
        default:
          updateStep(db, step.id, { status: "failed", finishedAt: nowSec(), ...base });
          updateRun(db, runId, { status: "failed", statusReason: `hard_stop:${String(errorText || "").slice(0, 80)}`, finishedAt: nowSec() });
          emit({ type: "cockpit:run", runId, status: "failed", reason: "hard_stop" });
          notifyTerminal(db, runId);
          return { ok: true, status: "failed", advanced: false, reason: "hard_stop" };
      }
    };

    // 9. Build the call.
    const rawArgs = resolveRefs(step.args, steps);
    const userAnswer = rawArgs && typeof rawArgs === "object" ? rawArgs.__userAnswer : undefined;
    const args = rawArgs && typeof rawArgs === "object" && "__userAnswer" in rawArgs ? (({ __userAnswer, ...rest }) => rest)(rawArgs) : rawArgs;
    let call = null;
    let doneSummary = null;
    if (resumed) {
      call = { tool: resumed.tool, args: step.args || {} };
    } else if (step.tool && !step.fallbackTool) {
      const vr = validateAndRepair({ tool: step.tool, args: args || {} }, { menuIds: [step.tool], getSpec, prior });
      if (vr.ok) { call = vr.call; repairs.push(...vr.repairs); }
    }
    if (!call && !resumed) {
      const forced = step.tool && !step.fallbackTool ? step.tool : null;
      const exclude = tried.filter((t) => t !== forced);
      const { menu } = await buildToolMenu({
        goal: step.goal, runGoal: run.goal, declaredTool: step.fallbackTool || step.tool, lensContext: run.lensContext,
        profile: run.modelProfile, lensActions: deps.lensActions, exclude,
      });
      const packet = await buildContextPacket({
        run, step, priorSteps: steps, menu, profile: run.modelProfile, userId: run.userId, deps: { recall: deps.recall, exec: deps.exec, lensActions: deps.lensActions },
        constraints: userAnswer ? [`User said: ${String(userAnswer).slice(0, 300)}`] : [],
      });
      const reask = REASK_CLASSES.has(step.errorClass) ? step.errorText : null;
      const r = await stepCall({ db, userId: run.userId, profile: run.modelProfile, packet, forcedTool: forced, reask });
      addUsage(db, runId, { modelCalls: r.modelCalls || 0, tokensIn: r.tokensIn || 0, tokensOut: r.tokensOut || 0 });
      if (!r.ok) return failStep(r.errorClass || "model_malformed", r.raw || "The model gave no usable answer.", null);
      if (r.call.tool === "ask_user") {
        updateStep(db, step.id, { status: "awaiting_confirm", errorText: String(r.call.args?.question || "").slice(0, 400), repairs });
        updateRun(db, runId, { status: "awaiting_confirm", statusReason: "question" });
        emit({ type: "cockpit:confirm", runId, stepId: step.id, kind: "question", label: step.goal, message: String(r.call.args?.question || "") });
        return { ok: true, status: "awaiting_confirm", advanced: false };
      }
      if (r.call.tool === "done") {
        doneSummary = { ok: true, result: { summary: r.call.args?.summary || "" } };
      } else {
        const vr = validateAndRepair(r.call, { menuIds: menu.map((m) => m.id), getSpec, prior });
        repairs.push(...vr.repairs);
        if (!vr.ok) return failStep("bad_args", vr.reask, null);
        call = vr.call;
      }
    }

    // Confirmation gate: write and high-risk calls wait for the person.
    if (call && !resumed && !doneSummary) {
      const eff = effectiveSpec(call, { lensActions: deps.lensActions });
      if (eff) {
        const gate = needsConfirm({ run, step, call, spec: eff, approvals: getApprovals(run) });
        if (gate.needed) {
          updateStep(db, step.id, { status: "awaiting_confirm", args: call.args, tool: call.tool, fallbackTool: null, repairs });
          updateRun(db, runId, { status: "awaiting_confirm", statusReason: "confirm" });
          emit({ type: "cockpit:confirm", runId, ...buildConfirmCard({ step, call, spec: eff }) });
          return { ok: true, status: "awaiting_confirm", advanced: false };
        }
      }
    }

    let res;
    if (resumed) {
      res = { ...resumed.result, ok: true, replayed: true };
    } else if (doneSummary) {
      res = { ok: true, tool: "done", result: doneSummary.result, errorClass: null, error: null, retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null };
    } else {
      // 13. Loop guard.
      const sig = `${step.id}|${call.tool}|${canonicalJson(call.args)}`;
      const seen = repairs.filter((r) => r.kind === "signature").map((r) => r.sig);
      if (seen.filter((x) => x === sig).length >= 2) {
        return failStep("looped", "The same call was about to run a third time.", call.tool);
      }
      repairs.push({ kind: "signature", sig });
      while (repairs.filter((r) => r.kind === "signature").length > 3) {
        repairs.splice(repairs.findIndex((r) => r.kind === "signature"), 1);
      }
      updateStep(db, step.id, { repairs });
      // 10. Execute.
      res = await runTool({ db, run, step, call, deps: { ...deps, getSpec } });
      addUsage(db, runId, { toolCalls: 1 });
      if (!res.ok) { lastRaw = res.raw; return failStep(res.errorClass || "tool_error", res.error, call.tool); }
    }

    // 11. Verify.
    const summary = summarizeResult(res.result, { tool: call?.tool || "done" });
    updateStep(db, step.id, { status: "verifying", result: res.result, resultSummary: summary, repairs });
    updateRun(db, runId, { status: "verifying" });
    const stepNow = { ...step, status: "verifying", result: res.result, resultSummary: summary };
    const v = await verify({ db, run, step: stepNow, call, result: res });
    // A pause the person asked for while this step ran must survive: only leave `verifying`.
    const backToRunning = () => { if (getRun(db, runId)?.status === "verifying") updateRun(db, runId, { status: "running" }); };
    if (v.pass) {
      let receipt = null;
      try { receipt = makeStepReceipt({ run, step: stepNow, call, result: res, checks: v.checks }); } catch { receipt = null; }
      updateStep(db, step.id, { status: "done", finishedAt: nowSec(), errorClass: null, ...(receipt ? { receipt } : {}) });
      backToRunning();
      emit({ type: "cockpit:step", runId, seq: step.seq, total, status: "done", label: getSpec(call?.tool)?.title || step.goal, receiptId: receipt ? step.id : null });
      return { ok: true, status: "running", advanced: true };
    }
    backToRunning();
    const failed = (v.checks || []).filter((c) => c.pass === false).map((c) => c.kind).join(", ");
    return failStep(v.errorClass || "verify_failed", `The result failed these checks: ${failed || "unknown"}.`, call?.tool || null);
  } finally {
    releaseLease(db, runId, owner);
  }
}

/** Tick until the run stops moving or the deadline passes. */
export async function driveRun(a) {
  const maxTicks = a.maxTicks ?? 50;
  let last = { ok: true, status: "planned", advanced: false };
  for (let i = 0; i < maxTicks; i++) {
    if (a.deadlineMs && Date.now() >= a.deadlineMs) break;
    last = await tickRun(a);
    if (!last.advanced) break;
    await new Promise((r) => { setImmediate(r); });
  }
  return last;
}
