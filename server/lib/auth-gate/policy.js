// server/lib/auth-gate/policy.js
//
// Central F0 policy — when autonomous missions enforce vs observe.

import { getConfig } from "../runtime/runtime-config.js";

const AUTONOMOUS_SOURCES = new Set([
  "proactive",
  "sentinel",
  "heartbeat",
  "scheduled",
  "initiative",
  "fleet",
  "watch",
  "system",
]);

const AUTONOMOUS_ROLES = new Set(["system", "sovereign"]);

/**
 * Resolve auth-gate mode for a dispatch context.
 * Returns "enforce" | "observe"
 */
export function resolveAuthGateMode(ctx = {}) {
  const globalMode = process.env.CONCORD_AUTH_GATE_MODE || "observe";
  if (globalMode === "enforce") return "enforce";

  const enforceAutonomous =
    process.env.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS === "true"
    || process.env.CONCORD_DILA_RUNTIME_ENFORCE === "1"
    || (ctx.db && getConfig(ctx.db, "auth_gate.enforce_autonomous", false) === true);

  if (!enforceAutonomous) return globalMode === "observe" ? "observe" : globalMode;

  const role = ctx.actor?.role || ctx.user?.role;
  const source = ctx.provenance?.source || ctx.why?.source || ctx.source;
  const missionSource = ctx.provenance?.mission_source;

  if (AUTONOMOUS_ROLES.has(role)) return "enforce";
  if (AUTONOMOUS_SOURCES.has(source)) return "enforce";
  if (AUTONOMOUS_SOURCES.has(missionSource)) return "enforce";
  if (ctx.provenance?.owner_agent_id === "hermes" && source !== "operator") return "enforce";

  return "observe";
}

export function isAutonomousContext(ctx = {}) {
  return resolveAuthGateMode(ctx) === "enforce";
}
