// The only way a cockpit run executes a tool (CKPT-09).
import { executeToolCall } from "../chat-agent.js";
import { withJob } from "../loop-job-tracker.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { classifyFailure } from "./failure-taxonomy.js";
import { getToolSpec, parseLensToolId } from "./tool-spec.js";
import { recordToolOutcomeEvent } from "./telemetry.js";

/** Turn a cockpit call into an executeToolCall call. */
export function toAgentCall(call) {
  const lens = parseLensToolId(call.tool);
  if (lens) return { tool: "run_lens_action", params: { domain: lens.domain, action: lens.action, params: call.args || {} } };
  return { tool: call.tool, params: call.args || {} };
}

/** Build the production exec for a user. */
export function makeExec({ db, userId, sessionId, runMacro, lensActions, surface }) {
  const role = (() => {
    try { return db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role || "member"; } catch { return "member"; }
  })();
  // `internal` is always false for runs: a run never bypasses the council gate, whatever the role.
  const ctx = {
    db, userPrompt: "", surface,
    actor: { userId, id: userId, sessionId: sessionId || null, role, internal: false },
    reqMeta: { sessionId: sessionId || null },
    log: () => {},
  };
  return async (agentCall) => executeToolCall(ctx, runMacro, lensActions, agentCall);
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
  let r;
  // CKPT-13: approval check here
  // CKPT-12: claim effect here
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout", error: "This step ran out of time." }), wall);
      if (typeof timer.unref === "function") timer.unref();
    });
    r = await Promise.race([
      withJob(`cockpit:${a.call.tool}`, () => a.deps.exec(toAgentCall(a.call))),
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
  return {
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
}
