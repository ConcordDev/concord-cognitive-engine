// server/lib/runtime/constants.js
//
// Dila runtime identity + policy defaults.

import { resolveAuthGateMode } from "../auth-gate/policy.js";

/** Hermes/Dila system account (migration 400). */
export const DILA_AGENT_ID = "hermes";
export const DILA_ENTITY_ID = "hermes-agent";
export const ZUKO_AGENT_ID = "zuko";

export const LOOP_PHASES = Object.freeze([
  "mission",
  "understand",
  "world_model",
  "decompose",
  "plan_dag",
  "allocate",
  "execute",
  "observe",
  "verify",
  "critique",
  "update_world_model",
  "learn",
  "replan",
  "continue",
]);

export const DIRECTORS = Object.freeze(["research", "engineering", "operations"]);

export const REPO_INDEX_STALE_SEC = Number(process.env.CONCORD_REPO_INDEX_STALE_SEC) || 3600;

export function defaultOwnerAgentId(opts = {}) {
  if (opts.ownerAgentId) return opts.ownerAgentId;
  if (opts.asDila || opts.principal === "dila") return DILA_AGENT_ID;
  return opts.userId === DILA_AGENT_ID ? DILA_AGENT_ID : (opts.userId || "system");
}

export function isAutonomousEnforceEnabled() {
  return resolveAuthGateMode({ actor: { role: "system" }, provenance: { source: "heartbeat" } }) === "enforce";
}

export { resolveAuthGateMode };
