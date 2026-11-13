// The only way a cockpit run executes a tool (CKPT-09).
import { executeToolCall } from "../chat-agent.js";
import { withJob } from "../loop-job-tracker.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { classifyFailure } from "./failure-taxonomy.js";
import { getToolSpec, effectiveSpec, parseLensToolId } from "./tool-spec.js";
import { claimEffect, completeEffect, failEffect, markEffectUnknown } from "./idempotency.js";
import { recordToolDispatch, recordToolOutcome } from "../marathon-tick-durability.js";
import { updateStep, getApprovals } from "./run-store.js";
import { needsConfirm } from "./confirm.js";
import { recordToolOutcomeEvent } from "./telemetry.js";
import { deskSlowThisCall } from "./desk-fixture.js";

/** Turn a cockpit call into an executeToolCall call. */
export function toAgentCall(call, key = null) {
  const lens = parseLensToolId(call.tool);
  if (lens) {
    return { tool: "run_lens_action", params: { domain: lens.domain, action: lens.action, params: call.args || {}, ...(key ? { idempotency_key: key } : {}) } };
  }
  return { tool: call.tool, params: { ...(call.args || {}), ...(key && call.tool === "run_lens_action" ? { idempotency_key: key } : {}) } };
}

/** Build the production exec for a user. */
export function makeExec({ db, userId, sessionId, runMacro, lensActions, surface, runId = null }) {
  const role = (() => {
    try { return db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role || "member"; } catch { return "member"; }
  })();
  // `internal` is always false for runs: a run never bypasses the council gate, whatever the role.
  const ctx = {
    db, userPrompt: "", surface,
    // A run's tools never start another run (start_long_task checks this).
    cockpitRunId: runId || "cockpit",
    actor: { userId, id: userId, sessionId: sessionId || null, role, internal: false },
    reqMeta: { sessionId: sessionId || null },
    log: () => {},
  };
  // Only the cockpit executor may set cockpitApproved, and only after a stored person-approval matched.
  return async (agentCall, opts = {}) => executeToolCall(opts.approved ? { ...ctx, cockpitApproved: true } : ctx, runMacro, lensActions, agentCall);
}

/**
 * @param {{ db: object, run: object, step: object, call: {tool:string,args:object},
 *           deps: { exec: Function, now?: () => number, getSpec?: Function } }} a
 */
export async function runTool(a) {
  const now = a.deps.now || (() => Date.now());
  const getSpec = a.deps.getSpec || ((id) => getToolSpec(id, { lensActions: a.deps.lensActions }));
  const spec = getSpec(a.call.tool);
  if (!spec) {
    return { ok: false, tool: a.call.tool, result: null, errorClass: "unknown_tool", error: "That step needs something that is not available.", retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null, raw: null };
  }
  const t0 = now();
  const wall = Math.min(spec.timeoutMs, a.run?.budget?.stepWallMs ?? spec.timeoutMs);
  const eff = effectiveSpec(a.call, { lensActions: a.deps.lensActions }) || spec;
  // Only write/high calls claim effects and persist args. Compute is not a write (same split as the confirm gate below).
  const writes = eff.risk === "write" || eff.risk === "high";
  let r;
  let key = null;
  let logId = null;
  // Defence in depth: a write or high-risk call without a matching stored approval never runs.
  if (eff.risk === "write" || eff.risk === "high") {
    const gate = needsConfirm({ run: a.run, step: a.step, call: a.call, spec: eff, approvals: getApprovals(a.run) });
    if (gate.needed) {
      return { ok: false, tool: a.call.tool, result: null, errorClass: "needs_confirm", error: "This step needs your approval.", retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null };
    }
  }
  if (writes) {
    const claim = claimEffect(a.db, { runId: a.run.id, stepId: a.step.id, tool: a.call.tool, args: a.call.args });
    if (claim.state === "replay") return { ...claim.result, replayed: true };
    if (claim.state === "error") {
      return { ok: false, tool: a.call.tool, result: null, errorClass: "tool_error", error: "Could not record this step, so it was not run.", retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null };
    }
    if (claim.state === "in_flight") {
      return { ok: false, tool: a.call.tool, result: null, errorClass: "in_flight", error: "This step may already be running.", retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null };
    }
    key = claim.key;
    logId = recordToolDispatch(a.db, a.run.id, a.step.seq, a.call.tool, a.call.args);
    updateStep(a.db, a.step.id, { idempotencyKey: key, tool: a.call.tool, args: a.call.args, fallbackTool: null });
  }
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout", error: "This step ran out of time." }), wall);
      if (typeof timer.unref === "function") timer.unref();
    });
    // Desk seam (refused in production): the first call of this tool in this run never answers in time.
    const slow = deskSlowThisCall(a.run.id, a.call.tool);
    r = await Promise.race([
      slow ? new Promise(() => {}) : withJob(`cockpit:${a.call.tool}`, () => a.deps.exec(toAgentCall(a.call, key), { approved: eff.risk === "high" })),
      timeout,
    ]);
  } catch (e) {
    r = { ok: false, reason: "handler_threw", error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
  if (!r || typeof r !== "object") r = { ok: false, error: "empty result" };
  try {
    recordToolOutcomeEvent(a.db, {
      userId: a.run.userId, sessionId: a.run.chatSessionId, surface: a.run.surface,
      call: { tool: a.call.tool, params: a.call.args }, result: r,
    });
  } catch { /* telemetry never blocks */ }
  const out = {
    ok: !!r.ok,
    tool: a.call.tool,
    result: r.ok ? (r.result ?? r) : null,
    errorClass: r.ok ? null : classifyFailure(r).class,
    error: r.ok ? null : scrubUserFacingToolNames(String(r.error || r.reason || "failed")),
    retryHint: r.retryHint || null,
    artifacts: r.artifacts || (r.artifact ? [r.artifact] : []),
    latencyMs: now() - t0,
    provider: null,
    model: null,
    raw: r,
  };
  if (key) {
    const stored = { ok: out.ok, tool: out.tool, result: out.result, errorClass: out.errorClass, error: out.error, retryHint: out.retryHint, artifacts: [], latencyMs: out.latencyMs, provider: null, model: null };
    if (out.ok) {
      completeEffect(a.db, key, stored);
      recordToolOutcome(a.db, logId, "completed", out.result);
    } else if (out.errorClass === "timeout") {
      // The write may have landed: leave the claim as unknown and the dispatch row as dispatched.
      markEffectUnknown(a.db, key);
    } else {
      failEffect(a.db, key);
      recordToolOutcome(a.db, logId, "failed", out.error);
    }
  }
  return out;
}
