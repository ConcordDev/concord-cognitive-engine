// server/lib/runtime/operator-gate.js
//
// Operator-only gate for the Runtime's private sister systems.
//
// Zuko (Kalshi book), Dila's AutoTrader (Coinbase config/limits), the
// pentester lab, the constellation health sweep, Dila's own agent state and
// the mission runtime all read the OPERATOR's private state off this Mac —
// and several accept caller-supplied `homes` / `repoRoot` paths. They were
// registered as ordinary lens actions, and an authenticated human bypasses
// the macro ACL, so any signed-up member (and Concord chat acting for one,
// which calls LENS_ACTIONS handlers directly) could read the Kalshi cash
// balance and trader limits and point the readers at arbitrary directories.
// Verified live 2026-09-27 before this gate existed.
//
// Wrapping at REGISTRATION is deliberate: it is the one choke point shared by
// /api/lens/run, chat's run_lens_action, runCapability() and MCP — a check in
// any single caller would leave the others open.
//
// Pinned by tests/runtime-operator-gate.test.js.

export const OPERATOR_ROLES = Object.freeze(["owner", "founder", "sovereign", "admin"]);

/**
 * Capability-registry owners whose capabilities are operator-only. Concordia
 * is deliberately absent: the game world is public. Used to decide what a
 * non-operator is even shown by capability discovery (chat list_capabilities).
 */
export const PRIVATE_CAPABILITY_OWNERS = Object.freeze([
  "zuko", "polymarket", "trading", "pentester", "constellation", "dila", "dila-mission",
  "mission-runtime", "predict", "browser_organ", "incident_engine",
  "opportunity_engine", "research_frontier", "trace_fabric_organ",
]);

/** True for the operator's own accounts and trusted internal server calls. */
export function isOperator(ctx) {
  const actor = ctx?.actor;
  if (!actor) return false;
  if (actor.internal === true && (actor.role === "system" || actor.role === "owner")) return true;
  return OPERATOR_ROLES.includes(actor.role);
}

export function operatorDenied(key) {
  return {
    ok: false,
    reason: "operator_only",
    error: `${key} reads the operator's private systems and is limited to the operator's own accounts.`,
  };
}

function gate(key, fn) {
  return (ctx, ...rest) => (isOperator(ctx) ? fn(ctx, ...rest) : operatorDenied(key));
}

/**
 * Wrap a `registerLensAction(domain, name, (ctx, artifact, params) => …)` or
 * `register(domain, name, (ctx, input) => …)` function so every handler it
 * registers is operator-only. Extra args (e.g. register's opts) pass through.
 */
export function operatorOnlyRegistrar(registrar) {
  return (domain, name, fn, ...rest) =>
    registrar(domain, name, typeof fn === "function" ? gate(`${domain}.${name}`, fn) : fn, ...rest);
}
