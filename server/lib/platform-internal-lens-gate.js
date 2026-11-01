// Domain-level role gate for platform-internal lens actions.
//
// ops and system are operator surfaces. Every action in those domains is
// checked once, on the lens-run dispatch path, with the same requireRole
// middleware admin routes already use. Handlers are not copied per
// action. Sentinel is intentionally absent: its state is per-account
// and is scoped in domains/sentinel.js. organ and root stay out of this set.
//
// debug was in this set until 2026-10-28 and was REMOVED on the founder's
// ruling (Product Review 2, debug.md §8: the wall was a bug, not a
// privileged-gating design). Every macro in domains/debug.js operates on
// per-account state (issues/traces/metrics/alerts/releases keyed by
// actor) or on caller-supplied artifacts (the analysis quartet) — it is
// a per-user observability workspace, not platform internals. The
// operator surfaces shown inside the Debug lens (events, logs,
// diagnostics) are served by the ops/system domains and substrate
// endpoints, which remain gated here. Anonymous writes inside debug
// stay refused by guardAnonWrites in the domain itself.

export const PLATFORM_INTERNAL_LENS_DOMAINS = Object.freeze(["ops", "system"]);

// Same list sibling admin routes pass to requireRole.
export const PLATFORM_INTERNAL_LENS_ROLES = Object.freeze(["owner", "admin", "sovereign", "founder"]);

const DOMAIN_SET = new Set(PLATFORM_INTERNAL_LENS_DOMAINS);

export function isPlatformInternalLensDomain(domain) {
  return DOMAIN_SET.has(String(domain || ""));
}

/**
 * Express path. Returns true when a response was already sent and the
 * caller must return. Non-matching domains return false without calling
 * requireRole, so mounts that omit the dependency keep working.
 */
export function enforcePlatformInternalLensRole(req, res, domain, requireRole) {
  if (!isPlatformInternalLensDomain(domain)) return false;
  if (typeof requireRole !== "function") {
    res.status(403).json({
      ok: false,
      error: "Insufficient permissions",
      requiredRoles: [...PLATFORM_INTERNAL_LENS_ROLES],
    });
    return true;
  }
  let allowed = false;
  requireRole(...PLATFORM_INTERNAL_LENS_ROLES)(req, res, () => { allowed = true; });
  return !allowed;
}

/**
 * Macro ctx path (lens.run, gateway, MCP) with no Express req.
 * Returns null when the caller may proceed, or { status, body } where
 * body is the JSON requireRole would have sent.
 */
export function platformInternalLensDenial(ctx, domain, requireRole) {
  if (!isPlatformInternalLensDomain(domain)) return null;
  const internal = ctx?.internal === true || ctx?.actor?.internal === true;
  const uid = ctx?.actor?.userId || ctx?.userId || null;
  const authed = uid && uid !== "anon" && uid !== "anonymous";
  const req = {
    user: authed
      ? {
          id: uid,
          role: ctx?.actor?.role,
          scopes: ctx?.actor?.scopes,
        }
      : null,
    ctx: { internal },
  };
  let status = 403;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  if (!enforcePlatformInternalLensRole(req, res, domain, requireRole)) return null;
  return {
    status,
    body: body || {
      ok: false,
      error: "Insufficient permissions",
      requiredRoles: [...PLATFORM_INTERNAL_LENS_ROLES],
    },
  };
}
