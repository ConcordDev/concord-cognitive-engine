/**
 * lens.update ownership gate (HANDOFF-SEC-2 Fix 7).
 *
 * The generic lens artifact update handler carried a social-domain
 * bypass: on forum, feed, marketplace, collab, thread, vote,
 * alliance, global, news and questmarket artifacts, ANY signed-in
 * member could overwrite ANY other user's artifact title/data/meta
 * (a forum post body, a marketplace listing's price, a collab
 * session). This predicate is the single rule the handler now
 * applies to every owned artifact, social or not:
 *
 *   allowed: internal callers, the artifact's owner, admins, and —
 *   on social domains only — moderator-class roles (the forum post
 *   lock in BoardPanel rides this path and is a moderator action).
 *
 * Denials are fresh objects. The 403 keeps the handler's historical
 * error text so existing clients see the same message, now with a
 * status/code beside it; a caller with no real user id gets 401.
 * Whether an artifact is "owned" at all (ownerless/anon artifacts)
 * is Fix 10's question and stays the handler's clause, not this
 * predicate's.
 */
import { FORUM_MOD_ROLES } from "./forum-mod-gate.js";

function isInternal(ctx) {
  return ctx?.internal === true || ctx?.actor?.internal === true;
}

function realUserId(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.actor?.odId || null;
  if (!id || id === "anon") return null;
  return String(id);
}

export function isModeratorActor(ctx) {
  const role = ctx?.actor?.role;
  if (typeof role === "string" && FORUM_MOD_ROLES.has(role.toLowerCase())) {
    return true;
  }
  const roles = ctx?.actor?.roles;
  if (Array.isArray(roles)) {
    return roles.some(
      (r) => typeof r === "string" && FORUM_MOD_ROLES.has(r.toLowerCase()),
    );
  }
  return false;
}

/**
 * @param {{ctx: object, isOwner: boolean, isAdmin: boolean, isSocialDomain: boolean}} args
 *   isOwner/isAdmin are resolved by the handler's existing
 *   _lensIsOwnerActor/_lensIsAdminActor helpers.
 * @returns {null | {ok:false, status:number, code:string, error:string}}
 */
export function lensUpdateDenial({ ctx, isOwner, isAdmin, isSocialDomain }) {
  if (isInternal(ctx)) return null;
  if (isOwner || isAdmin) return null;
  if (isSocialDomain && isModeratorActor(ctx)) return null;
  if (!realUserId(ctx)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "sign in required",
    };
  }
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN",
    error: "unauthorized: you can only update your own artifacts",
  };
}
