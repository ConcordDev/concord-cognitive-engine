// Thread node gate — ownership/moderation checks for artifact-scoped thread
// lens actions (`thread.merge`, `thread.delete_node` in server/server.js).
//
// SECURITY: `thread` is a LENS_SOCIAL_DOMAINS domain, so the generic lens run
// path lets ANY signed-in member act on ANY member's thread artifact:
//   * `merge` appends a merge node built from other users' branch contents;
//   * `delete_node` removes a node AND all of its descendants — including
//     other users' replies — from anyone's thread.
// Safest product default: only the thread owner, a moderator-class role, or
// an internal/admin caller may merge or moderate-delete; a plain member may
// only delete a node whose ENTIRE removed subtree (the node plus every
// descendant) is their own. Mirrors FORUM_MOD_ROLES from forum-mod-gate.js
// (kept in sync deliberately; do not widen without a security review).

import { FORUM_MOD_ROLES } from "./forum-mod-gate.js";

/**
 * Shared allow check: internal callers, the thread owner, or any
 * moderator-class role (role string or any entry of the roles array,
 * case-insensitive).
 * @param {{ isThreadOwner?: boolean, role?: string, roles?: string[], internal?: boolean }} input
 * @returns {boolean}
 */
function _threadActorAllowed(input) {
  const { isThreadOwner, role, roles, internal } = input || {};
  if (internal === true || isThreadOwner === true) return true;
  if (FORUM_MOD_ROLES.has(String(role || "").toLowerCase())) return true;
  if (Array.isArray(roles) && roles.some((r) => FORUM_MOD_ROLES.has(String(r).toLowerCase()))) return true;
  return false;
}

function _authRequired() {
  return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };
}

/**
 * Gate for `thread.merge`. Returns null when the actor is allowed (internal,
 * thread owner, or moderator-class role); otherwise a denial result the
 * caller must return verbatim. Order matters: internal/owner/mod-role allow
 * first, then signed-in check (401), then everyone else is a plain member
 * (403). Returns a FRESH object on every denial.
 * @param {{ isThreadOwner?: boolean, role?: string, roles?: string[], internal?: boolean, userId?: string }} input
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function threadModerationDenial(input) {
  const { userId } = input || {};
  if (_threadActorAllowed(input)) return null;
  if (!userId || userId === "anon") return _authRequired();
  return { ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the thread owner or a moderator can do this" };
}

/**
 * Gate for `thread.delete_node`. Returns null when the actor is internal, the
 * thread owner, a moderator-class role, OR a signed-in author deleting a
 * node whose ENTIRE removed subtree (removedNodes = the node plus every
 * descendant) is their own; otherwise a denial result the caller must return
 * verbatim. Order matters: internal/owner/mod-role allow first, then
 * signed-in check (401), then the own-subtree check, then 403. Returns a
 * FRESH object on every denial.
 * @param {{ isThreadOwner?: boolean, role?: string, roles?: string[], internal?: boolean, userId?: string, removedNodes?: Array<{ authorId?: string }> }} input
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function threadDeleteNodeDenial(input) {
  const { userId, removedNodes } = input || {};
  if (_threadActorAllowed(input)) return null;
  if (!userId || userId === "anon") return _authRequired();
  const ownWholeSubtree = Array.isArray(removedNodes)
    && removedNodes.length > 0
    && removedNodes.every((n) => n && n.authorId === userId);
  if (ownWholeSubtree) return null;
  return { ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: you can only delete your own nodes" };
}