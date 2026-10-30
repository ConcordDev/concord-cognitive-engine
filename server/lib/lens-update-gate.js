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
 *
 * Fix 10 (below) closes the remaining half: artifacts with NO concrete
 * owner at all (ownerId/createdBy/createdByUser missing or a sentinel
 * — "anon", "anonymous", "system") were skipped by every ownership
 * clause, so any signed-in member could rewrite or publish them,
 * including marketplace artifacts carrying no owner fields at all.
 * Ownerless writes are admin/internal-only, plus moderators on
 * social domains (the Fix 7 rule), and AUTH_MODE=public keeps the
 * solo local-first behavior (the only "user" is anon by design).
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

const OWNERLESS_SENTINELS = new Set(["anon", "anonymous", "system"]);

function isConcreteOwnerId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !OWNERLESS_SENTINELS.has(value.toLowerCase())
  );
}

/**
 * An artifact is ownerless when NONE of its owner fields names a
 * concrete owner: ownerId missing/"anon"/"anonymous"/"system" AND
 * createdBy/createdByUser likewise absent or sentinel. A real
 * createdBy counts as ownership even when ownerId is missing (the
 * handler's _lensIsOwnerActor already matches on it). Stamps like
 * "pipeline" are concrete non-user owners — not ownerless; they stay
 * on the owned path, where only admins can write.
 */
export function isOwnerlessArtifact(artifact) {
  if (!artifact) return true;
  return (
    !isConcreteOwnerId(artifact.ownerId) &&
    !isConcreteOwnerId(artifact.createdBy) &&
    !isConcreteOwnerId(artifact.createdByUser)
  );
}

/**
 * Write gate for ownerless artifacts (lens.update and the
 * /api/lens/:domain/:id/publish route).
 *
 * @param {{ctx: object, isAdmin: boolean, isSocialDomain: boolean,
 *          authMode?: string, forbiddenError?: string}} args
 *   isAdmin is resolved by the handler's _lensIsAdminActor. authMode
 *   is the server's AUTH_MODE; "public" is the solo local-first mode
 *   and never denies (mirrors dtuMutationDenial's public early
 *   return). forbiddenError lets the publish route keep its
 *   historical "not your artifact" text; lens.update keeps the
 *   update handler's text.
 * @returns {null | {ok:false, status:number, code:string, error:string}}
 */
export function lensOwnerlessDenial({
  ctx,
  isAdmin,
  isSocialDomain,
  authMode,
  forbiddenError,
}) {
  if (isInternal(ctx)) return null;
  if (authMode === "public") return null;
  if (isAdmin) return null;
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
    error: forbiddenError || "unauthorized: you can only update your own artifacts",
  };
}
