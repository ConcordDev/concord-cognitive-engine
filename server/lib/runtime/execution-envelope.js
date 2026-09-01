// server/lib/runtime/execution-envelope.js
//
// Concord Runtime — Universal Execution Envelope (docs/
// CONCORD_RUNTIME_MASTER_SPEC.md §3). Every capability invocation through
// this module gets the SAME request/result shape regardless of domain —
// so the Runtime can observe everything without understanding every
// domain, per the master spec's own framing.
//
// This is ADDITIVE, not a replacement for /api/lens/run — the HTTP route
// stays exactly as-is (10,000+ macro pairs already call through it; nothing
// here changes that path). runCapability() is a second, in-process entry
// point for Runtime-orchestrated calls (heartbeats, agents, other domains)
// that also want the registry lookup + event-bus visibility + structured
// result shape. It dispatches through the SAME underlying handlers
// /api/lens/run uses — globalThis.__concordLensActions (LENS_ACTIONS) and
// globalThis.__concordRunMacro (the MACROS-family runMacro function) —
// both already exposed for exactly this kind of cross-module reuse (see
// server.js's own comments at those two assignments).
import { randomUUID } from "node:crypto";
import { getCapabilityDescriptor, checkCapabilityHealth } from "./capability-registry.js";
import { publish } from "./event-bus.js";

/**
 * @typedef {object} ExecutionRequest
 * @property {string} capability   "domain.action"
 * @property {object} [ctx]        The caller's real ctx (db, actor, etc.) —
 *   REQUIRED for anything beyond a registry-lookup dry run; this module
 *   does not construct ctx itself (that's makeCtx(req) for HTTP callers,
 *   or a minimal internal ctx for heartbeat/agent callers — see
 *   emergent/predict-research-cycle.js for the established pattern).
 * @property {string} [actor]      Free-text actor id, for the result envelope only.
 * @property {string} [intent]     Why this call is happening, free text.
 * @property {object} [input]
 * @property {object} [constraints]
 * @property {object} [provenance]
 */

/**
 * @typedef {object} ExecutionResult
 * @property {string} requestId
 * @property {"ok"|"error"} status
 * @property {*} [result]
 * @property {string} [reason]
 * @property {number} durationMs
 * @property {object} [provenance]
 */

/**
 * @param {ExecutionRequest} request
 * @returns {Promise<ExecutionResult>}
 */
export async function runCapability(request) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const capability = request?.capability;

  const fail = (reason, extra = {}) => {
    const durationMs = Date.now() - startedAt;
    publish("capability.failed", { requestId, capability, reason, durationMs, ...extra });
    return { requestId, status: "error", reason, durationMs, ...extra };
  };

  if (!capability || typeof capability !== "string") return fail("missing_capability");
  const descriptor = getCapabilityDescriptor(capability);
  if (!descriptor) return fail("capability_not_registered");

  const health = checkCapabilityHealth(capability);
  if (!health.reachable) return fail("capability_unreachable", { detail: health.reason });

  const ctx = request.ctx;
  if (!ctx) return fail("missing_ctx");

  publish("capability.invoked", { requestId, capability, actor: request.actor || ctx?.actor?.userId || null, intent: request.intent || null });

  const [domain, action] = capability.split(".");
  const input = request.input || {};

  try {
    let raw;
    const lensActions = globalThis.__concordLensActions;
    if (lensActions instanceof Map && lensActions.has(capability)) {
      const handler = lensActions.get(capability);
      const artifact = { id: null, domain, type: "domain_action", data: input, meta: {} };
      raw = await handler(ctx, artifact, input);
    } else {
      const runMacro = globalThis.__concordRunMacro;
      if (typeof runMacro !== "function") return fail("run_macro_unavailable");
      raw = await runMacro(domain, action, input, ctx);
    }

    const durationMs = Date.now() - startedAt;
    // Both dispatch families use {ok:false, reason|error} for a handled
    // failure — surface that as status:"error" here too, not a false "ok".
    if (raw && typeof raw === "object" && raw.ok === false) {
      const reason = raw.reason || raw.error || "handler_reported_failure";
      publish("capability.failed", { requestId, capability, reason, durationMs });
      return { requestId, status: "error", reason, result: raw, durationMs };
    }

    publish("capability.completed", { requestId, capability, durationMs });
    return { requestId, status: "ok", result: raw, durationMs, provenance: request.provenance || null };
  } catch (err) {
    return fail("handler_threw", { detail: err?.message || String(err) });
  }
}
