// server/lib/mcp-hermes-identity.js
//
// Hermes MCP Execution Bridge — scoped service identity.
//
// Hermes (user id `hermes`) is a dedicated service account for agent callers.
// It must NEVER impersonate a human operator (Ramaj / any other userId).
// Calls are attributed to hermes, audited via F0 TRACE_ID, and gated by
// least-privilege scopes + per-action risk class.
//
// Scopes (API-key / actor.scopes):
//   mcp:lens:read      — list_lens_actions, read-shaped lens actions
//   mcp:lens:compute   — compute/read lens actions (no durable mutation)
//   mcp:lens:write     — write-shaped lens actions
//   mcp:lens:high      — payment/publish/deploy/destructive (+ approval)
//   mcp:conkay:read    — conkay_solver_list
//   mcp:conkay:compute — conkay_solve
//   *                  — unrestricted (operator keys only; not the default Hermes key)

export const HERMES_USER_ID = "hermes";

/** Default least-privilege scopes for the Hermes bridge service key. */
export const HERMES_BRIDGE_DEFAULT_SCOPES = Object.freeze([
  "mcp:lens:read",
  "mcp:lens:compute",
  "mcp:conkay:read",
  "mcp:conkay:compute",
]);

/** Risk classes used by the bridge (maps onto F0 RISK_TIERS + approval). */
export const BRIDGE_RISK = Object.freeze({
  READ: "read",
  COMPUTE: "compute",
  WRITE: "write",
  HIGH: "high",
});

const HIGH_ACTION_RE =
  /\b(pay|payment|purchase|withdraw|transfer|publish|deploy|delete|destroy|wipe|purge|reset|revoke|impersonate|approve|mint|debit|credit|ban|promote|demote)\b/i;
const WRITE_ACTION_RE =
  /\b(create|update|edit|save|set|add|remove|write|insert|upsert|post|send|submit|open|export|install|register|bind|claim|place|cancel)\b/i;

/**
 * Classify a (domain, action) pair into a bridge risk class.
 * Prefer an explicit capability-registry risk when present.
 */
export function classifyLensActionRisk(domain, action, registryRisk = null) {
  if (registryRisk && ["read", "compute", "write", "execute", "high"].includes(registryRisk)) {
    if (registryRisk === "high") return BRIDGE_RISK.HIGH;
    if (registryRisk === "write" || registryRisk === "execute") return BRIDGE_RISK.WRITE;
    if (registryRisk === "compute") return BRIDGE_RISK.COMPUTE;
    return BRIDGE_RISK.READ;
  }
  const name = `${domain}.${action}`;
  if (HIGH_ACTION_RE.test(name)) return BRIDGE_RISK.HIGH;
  if (WRITE_ACTION_RE.test(action) || WRITE_ACTION_RE.test(name)) return BRIDGE_RISK.WRITE;
  return BRIDGE_RISK.COMPUTE;
}

function scopeSet(actor) {
  const scopes = actor?.scopes;
  if (!Array.isArray(scopes)) return new Set();
  return new Set(scopes.map(String));
}

function hasWildcard(scopes) {
  return scopes.has("*") || scopes.has("all");
}

/**
 * Scope required for a bridge risk on the lens path.
 */
export function requiredLensScope(risk) {
  switch (risk) {
    case BRIDGE_RISK.HIGH: return "mcp:lens:high";
    case BRIDGE_RISK.WRITE: return "mcp:lens:write";
    case BRIDGE_RISK.COMPUTE: return "mcp:lens:compute";
    default: return "mcp:lens:read";
  }
}

export function requiredConkayScope(risk) {
  return risk === BRIDGE_RISK.READ ? "mcp:conkay:read" : "mcp:conkay:compute";
}

/**
 * Reject impersonation attempts. Hermes (and every bridge caller) acts as
 * itself — never as another userId supplied in args.
 */
export function rejectImpersonation(actor, args = {}) {
  const actorId = actor?.id || actor?.userId || null;
  if (!actorId) {
    return { ok: false, reason: "auth_required", error: "Authentication required for MCP execution bridge tools" };
  }
  const forbiddenKeys = ["as_user", "asUser", "impersonate", "impersonateUserId", "actingAs"];
  for (const k of forbiddenKeys) {
    if (args[k] != null && String(args[k]) !== String(actorId)) {
      return {
        ok: false,
        reason: "impersonation_forbidden",
        error: `MCP bridge refuses ${k}=${args[k]}; calls are attributed to the authenticated service identity only`,
      };
    }
  }
  // Cross-tenant userId override on the params payload
  const params = args.params && typeof args.params === "object" ? args.params : {};
  for (const k of ["userId", "user_id", "ownerId", "owner_id"]) {
    if (params[k] != null && String(params[k]) !== String(actorId)) {
      return {
        ok: false,
        reason: "tenant_isolation",
        error: `params.${k} must match the authenticated actor (got ${params[k]}, actor ${actorId})`,
      };
    }
  }
  return { ok: true, actorId: String(actorId) };
}

/**
 * Authorize a bridge tool call against the caller's scopes + risk class.
 * High-risk requires explicit approval:true (or approval_token).
 */
export function authorizeBridgeCall({
  actor,
  tool,
  risk,
  domain = null,
  approval = false,
  approvalToken = null,
}) {
  if (!actor?.id && !actor?.userId) {
    return { ok: false, reason: "auth_required", error: "Authentication required" };
  }
  const scopes = scopeSet(actor);
  // Unscoped human sessions (JWT cookie with no scopes array) get full
  // surface — same as empty API-key scopes meaning unrestricted. Hermes
  // service keys MUST carry explicit scopes (mint script sets them).
  const isHermes = String(actor.id || actor.userId) === HERMES_USER_ID;
  if (isHermes && scopes.size === 0) {
    return {
      ok: false,
      reason: "hermes_scopes_required",
      error: "Hermes service identity requires explicit mcp:* scopes on the API key",
    };
  }

  if (!hasWildcard(scopes) && scopes.size > 0) {
    const need =
      tool === "conkay_solve" || tool === "conkay_solver_list"
        ? requiredConkayScope(risk)
        : requiredLensScope(risk);
    // Allow a broader scope to satisfy a narrower need:
    // high ⊃ write ⊃ compute ⊃ read
    const ladder =
      tool.startsWith("conkay_")
        ? ["mcp:conkay:read", "mcp:conkay:compute"]
        : ["mcp:lens:read", "mcp:lens:compute", "mcp:lens:write", "mcp:lens:high"];
    const needIdx = ladder.indexOf(need);
    const hasLadder = ladder.some((s, i) => i >= needIdx && scopes.has(s));
    // Also accept a domain-scoped key (e.g. scopes:["physics"]) for lens calls
    const hasDomain = domain && scopes.has(domain);
    if (!hasLadder && !hasDomain) {
      return {
        ok: false,
        reason: "scope_denied",
        error: `scope ${need} required for ${tool} (risk=${risk})`,
        required_scope: need,
        actor_scopes: [...scopes],
      };
    }
  }

  if (risk === BRIDGE_RISK.HIGH) {
    if (approval !== true && !approvalToken) {
      return {
        ok: false,
        reason: "approval_required",
        error: "High-risk action requires explicit authorization (approval:true + mcp:lens:high scope)",
        risk,
      };
    }
  }

  return { ok: true, risk, actorId: String(actor.id || actor.userId) };
}

/** Build the actor stamp used on ctx for lens dispatch. */
export function bridgeActorCtx(actor) {
  const id = String(actor?.id || actor?.userId || "");
  return {
    userId: id,
    id,
    role: actor?.role || (id === HERMES_USER_ID ? "sovereign" : "member"),
    scopes: Array.isArray(actor?.scopes) ? actor.scopes : [],
    orgId: actor?.orgId || "default",
    service: id === HERMES_USER_ID ? "hermes-mcp-bridge" : null,
    internal: false,
  };
}
