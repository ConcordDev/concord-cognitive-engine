// server/lib/auth-gate/gates/capability.js
//
// F0.5 gate wrapper — wraps the EXISTING capability-registry module.
// Per the locked spec: this returns risk tier, authorization requirements,
// and health. It does NOT define new policy.

import { getCapabilityDescriptor, checkCapabilityHealth } from "../../runtime/capability-registry.js";
import { RISK_TO_AUTHORITY } from "../envelope.js";

/**
 * Look up capability metadata. Returns:
 *   - {ok: true, descriptor, health, risk, authority_required}
 *   - {ok: false, reason_code}
 *
 * Capabilities NOT registered (most current MCP tools) are NOT a denial —
 * they fall through to "unregistered_but_dispatchable" with a WARNING.
 * This matches the existing execution-envelope.js behavior.
 */
export async function check(envelope) {
  // Most MCP tools are snake_case "web_search"; the registry expects "domain.action"
  const capability = inferCapability(envelope.WHAT);

  let descriptor = null;
  try {
    descriptor = getCapabilityDescriptor(capability);
  } catch (e) {
    // Registry may throw on unknown; treat as unregistered
    descriptor = null;
  }

  if (!descriptor) {
    return {
      ok: true, // not a denial; just unregistered
      registered: false,
      reason_code: "capability_unregistered_but_dispatchable",
      risk: "read",  // safest default
      authority_required: { ...RISK_TO_AUTHORITY.read },
    };
  }

  let health = { reachable: true, reason: "no_health_check_available" };
  try {
    health = checkCapabilityHealth(capability);
  } catch (e) {
    health = { reachable: false, reason: e?.message || String(e) };
  }

  return {
    ok: health.reachable === true,
    registered: true,
    descriptor,
    health,
    risk: descriptor.risk || "read",
    authority_required: RISK_TO_AUTHORITY[descriptor.risk] || RISK_TO_AUTHORITY.read,
    reason_code: health.reachable ? "capability_ok" : "capability_unreachable",
  };
}

function inferCapability(toolName) {
  // MCP tools are "snake_case"; registry uses "domain.action"
  // Try: "domain_action" → if not found, fall through to "unregistered"
  if (!toolName || typeof toolName !== "string") return "unknown";
  if (toolName.includes(".")) return toolName;  // already canonical
  // Best-effort: "web_search" → "web.search"
  const parts = toolName.split("_");
  if (parts.length >= 2) {
    return `${parts[0]}.${parts.slice(1).join("_")}`;
  }
  return toolName;
}