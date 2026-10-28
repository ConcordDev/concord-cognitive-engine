// Forum moderation gate — shared role check for artifact-scoped forum lens
// actions (`forum.pin`, `forum.moderate` in server/server.js).
//
// SECURITY: `forum` is a LENS_SOCIAL_DOMAINS domain, so the generic lens run
// path lets ANY signed-in member act on ANY member's forum post artifact.
// Pinning and moderation mutate other people's posts, so they are restricted
// to moderator-class roles. Mirrors domains/forum.js FM_MOD_ROLES (kept in
// sync deliberately; do not widen without a security review).

// Same role set as domains/forum.js FM_MOD_ROLES — moderator-class only.
export const FORUM_MOD_ROLES = Object.freeze(new Set([
  "moderator",
  "admin",
  "owner",
  "founder",
  "sovereign",
]));

const _AUTH_REQUIRED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });
const _FORBIDDEN = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: moderator role required" });

/**
 * Gate for forum moderation actions (pin/moderate).
 * Returns null when the actor is allowed (internal callers, or a
 * moderator-class role via ctx.actor.role or ctx.actor.roles); otherwise a
 * denial result the caller must return verbatim.
 * Order matters: internal/mod-role allow first, then signed-in check (401),
 * then everyone else is a plain member (403).
 * @param {{ internal?: boolean, actor?: { internal?: boolean, userId?: string, role?: string, roles?: string[] } }} ctx
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function forumModDenial(ctx) {
  if (ctx?.internal === true || ctx?.actor?.internal === true) return null;
  const actor = ctx?.actor;
  const role = String(actor?.role || "").toLowerCase();
  if (FORUM_MOD_ROLES.has(role)) return null;
  const roles = actor?.roles;
  if (Array.isArray(roles) && roles.some((r) => FORUM_MOD_ROLES.has(String(r).toLowerCase()))) return null;
  const userId = actor?.userId;
  if (!userId || userId === "anon") return _AUTH_REQUIRED;
  return _FORBIDDEN;
}