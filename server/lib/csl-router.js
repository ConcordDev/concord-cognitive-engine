// server/lib/csl-router.js
//
// Sprint 33 Phase 5 (cc-sonnet) — per docs/SPRINT-33-SPECS.md "Worker: cc-sonnet".
//
// The pre-dispatch tool gate that lets CSL (Concord Semantic Operating System,
// docs/SPRINT-33-CSL-PLAN.md) sit BETWEEN "the brain proposed a tool call" and
// "the tool actually dispatches", without touching the conversational turn at
// all. This is the `opts.toolGate(call)` shape chat-agent.js's loop already
// expects (chat-agent.js:690), modeled directly on the reference
// implementation at server/lib/agent-marathon.js#createToolGate (:321-395).
//
// Design source: docs/SPRINT-33-MACRO-TRACE.md §9. There is no single
// macro-vs-chat gate in Concord today — two independent tool-call loops exist
// (chat-agent.js:127's executeToolCall, and server.js:26276's local
// _executeToolCall inside the `chat.respond` macro), both parsing
// `[TOOL_CALL:{...}]` text markers post-hoc from brain output. This module is
// wired into BOTH (server/routes/chat-agent-stream.js for the agent loop,
// server.js's chat.respond handler for plain chat) — see docs/SPRINT-33-SPECS.md
// Tasks 3/4 for why unifying the two loops is explicitly out of scope here.
//
// Contract: toolGate(call) never throws and never blocks a non-macro tool.
// Internal CSL failures fail OPEN (matching chat-agent.js:691's own doctrine:
// "a bad callback must never abort the agent's actual work") unless
// CONCORD_CSL_FAIL_CLOSED=true.

import logger from "../logger.js";

// Tools that actually dispatch a macro / mutate state. Read-only or
// already-sandboxed tools (web_search, run_compute, browse_url, expert_mode,
// generate_image, mcp_*, run_python, browser_act) are deliberately excluded —
// gating them would add latency for zero safety gain and would violate
// operator constraint #1 (chat/ConKay must stay conversational) more than it
// protects anything. Exported so both call sites (chat-agent.js's loop and
// chat.respond's embedded loop) gate on the exact same tool-name set.
export const MACRO_DISPATCH_TOOLS = new Set([
  "run_lens_action",
  "create_dtu",
  "create_document",
  "export_dtu",
  "run_authored_tool",
]);

const FAIL_CLOSED = String(process.env.CONCORD_CSL_FAIL_CLOSED || "").toLowerCase() === "true";

/**
 * Build a fresh, per-request tool gate. MUST be constructed fresh per
 * chat.respond invocation / per /api/chat-agent/stream request — never
 * hoisted to module scope — since it closes over sessionId/userId (a shared
 * instance would leak one user's session context into another's gate calls,
 * same discipline agent-marathon.js#createToolGate follows per-tick).
 *
 * The returned `toolGate` function also carries a `shiftDecision()` method
 * (Sprint 33 Task 6 — surfacing the routing decision to the caller for the
 * badge). chat-agent.js's executeToolCall loop is explicitly off-limits to
 * edit (docs/SPRINT-33-SPECS.md Task 3: "you may NOT edit chat-agent.js
 * itself"), and its existing `emit("tool_call", result)` call
 * (chat-agent.js:737) does not merge gate metadata into `result` on the
 * success path — so there is no way to attach `cslRouted`/`proofArtifact`
 * onto the SSE payload from inside chat-agent.js without editing it. Instead,
 * every `toolGate(call)` invocation appends one entry to an internal FIFO
 * queue; chat-agent.js calls `opts.toolGate(call)` exactly once per queued
 * tool call, in the same order it later emits `tool_call` for that same call
 * (chat-agent.js:690-737) — so the SSE route (server/routes/chat-agent-stream.js)
 * can `shiftDecision()` once per `tool_call` event it forwards and enrich the
 * outgoing payload, entirely outside chat-agent.js.
 *
 * @param {object} opts
 * @param {(turnText: string, ctx: object) => Promise<{ok: boolean, reason?: string, proofArtifact?: object}>} opts.runCsl
 *   Injected — in production this is csl-core.js's `executeTurn` bound to a
 *   ConcordSoSRuntime instance. Injected rather than imported directly so
 *   this module never hard-depends on csl-core.js landing first, and so
 *   tests can mock it (same DI discipline as every other Sprint-33 file).
 * @param {string} [opts.sessionId]
 * @param {string} [opts.userId]
 * @param {string} [opts.clientIntentHint] Advisory only (Task 5) — the
 *   frontend's own coarse dispatch-branch label (vision/slash/skill/macro/
 *   chat, per docs/SPRINT-33-FRONTEND-AUDIT.md §5). Never trusted for the
 *   gate decision itself; threaded into the runCsl call and the log line
 *   purely for telemetry/debugging.
 * @returns {(call: {tool: string, params?: object}) => Promise<{ok: boolean, cslRouted: boolean, reason?: string, halt?: boolean, proofArtifact?: object, cslError?: string}> & { shiftDecision: () => object|undefined }}
 */
export function createCslToolGate({ runCsl, sessionId, userId, clientIntentHint } = {}) {
  const _decisionLog = [];

  const toolGate = async function toolGate(call) {
    const tool = call?.tool;

    if (!MACRO_DISPATCH_TOOLS.has(tool)) {
      // Pass through untouched — no CSL invocation, no log line. This is the
      // structural guarantee that conversational turns never see CSL: a
      // call whose tool isn't in MACRO_DISPATCH_TOOLS returns here before
      // anything else runs. Still logged into the decision queue (cslRouted:
      // false) so shiftDecision() stays 1:1 with every tool_call emission,
      // gated or not. `cslRouted` also rides the direct return value (not
      // just the queue) so a caller with synchronous access to this result
      // (server.js's chat.respond path) never has to infer it from shape.
      _decisionLog.push({ tool, cslRouted: false });
      return { ok: true, cslRouted: false };
    }

    const domain = call?.params?.domain;
    const action = call?.params?.action;

    // NOTE: an earlier draft of this gate re-classified `call.tool` /
    // `domain` / `action` through chat/intent-router.js#classifyIntent as a
    // defensive "shouldn't happen but never block on a misclassification"
    // check. Verified at implementation time (server/lib/csl-router.js smoke
    // test) that this was actively wrong: classifyIntent's tool-action
    // detector requires a verb token + a known-noun token with real word
    // boundaries (chat/intent-router.js:154-190), which a
    // `"run_lens_action accounting createBudget"`-shaped string never
    // satisfies (no bare "create" token — "createBudget" has no \b before
    // "Budget"). Every real macro-dispatch call classified as "language" and
    // silently bypassed CSL, defeating the gate's one job. Dropped:
    // membership in MACRO_DISPATCH_TOOLS (checked above) IS the intent
    // signal here — classifyIntent is for raw chat text, not tool params.

    try {
      if (typeof runCsl !== "function") {
        // csl-core.js not wired in this deployment/test — degrade to pass-through
        // rather than throwing. Never a hard dependency at call time. cslRouted
        // stays false: CSL didn't actually validate anything here.
        _logGateDecision({ tool, domain, action, ok: true, sessionId, userId, note: "runCsl_unavailable" });
        _decisionLog.push({ tool, cslRouted: false });
        return { ok: true, cslRouted: false };
      }

      // The real CSL validation pass — csl-core's invariant gates run here,
      // BEFORE the macro dispatches. Not a parallel second confirm: this is
      // the ConKay mutating-confirm gate's server-side counterpart for the
      // CSL-formal path, not an additional one.
      const result = await runCsl(JSON.stringify(call.params || {}), {
        sessionId,
        userId,
        domainHint: domain,
        macroHint: action,
        clientIntentHint,
      });

      const ok = !!(result && result.ok);
      _logGateDecision({ tool, domain, action, ok, sessionId, userId });

      if (!ok) {
        _decisionLog.push({ tool, cslRouted: true });
        return { ok: false, reason: (result && result.reason) || "csl_rejected", cslRouted: true };
      }
      _decisionLog.push({ tool, cslRouted: true, proofArtifact: result && result.proofArtifact });
      return { ok: true, cslRouted: true, proofArtifact: result && result.proofArtifact };
    } catch (err) {
      const cslError = String(err?.message || err);
      _logGateDecision({ tool, domain, action, ok: !FAIL_CLOSED, sessionId, userId, note: "csl_error", error: cslError });
      if (FAIL_CLOSED) {
        _decisionLog.push({ tool, cslRouted: true, cslError });
        return { ok: false, reason: "csl_error", cslError, cslRouted: true };
      }
      // FAIL OPEN (default) — CSL is additive validation, not a new single
      // point of failure for tool use. Matches agent-marathon.js:330-331's
      // own "governance columns absent — never block on a missing envelope"
      // doctrine.
      _decisionLog.push({ tool, cslRouted: true, cslError });
      return { ok: true, cslRouted: true, cslError };
    }
  };

  // Task 6 — surfaced for the SSE route / chat.respond caller to read back,
  // WITHOUT requiring any edit to chat-agent.js. See the doc comment above.
  toolGate.shiftDecision = () => _decisionLog.shift();

  return toolGate;
}

/**
 * One structured log line per gate decision — never throws. This is what
 * makes the ConKay badge's "CSL-routed" claim independently verifiable
 * server-side (CLAUDE.md's runtime-truth discipline: "if a claim is
 * checkable at runtime, check it at runtime"), not just trusted from the
 * client's own rendering.
 */
function _logGateDecision({ tool, domain, action, ok, sessionId, userId, note, error }) {
  try {
    logger.info("csl-router", "gate_decision", { tool, domain, action, ok, sessionId, userId, note, error });
  } catch {
    /* logging must never break the gate */
  }
}

export const CSL_ROUTER_CONSTANTS = Object.freeze({
  MACRO_DISPATCH_TOOLS: [...MACRO_DISPATCH_TOOLS],
  FAIL_CLOSED,
});

export default { createCslToolGate, MACRO_DISPATCH_TOOLS, CSL_ROUTER_CONSTANTS };
