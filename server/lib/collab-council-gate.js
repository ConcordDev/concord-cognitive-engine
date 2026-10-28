// Collab council gate — ownership/moderation check for the artifact-scoped
// collab lens action (`collab.run_council` in server/server.js).
//
// SECURITY: `collab` is a LENS_SOCIAL_DOMAINS domain, so the generic lens run
// path lets ANY signed-in member act on ANY member's collab session
// artifact. `run_council` OVERWRITES artifact.data.councilVote — replacing an
// in-progress council vote with a new "pending" one on an attacker-chosen
// topic. Safest product default: only the session owner, a moderator-class
// role, or an internal/admin caller may start a council vote. Mirrors
// FORUM_MOD_ROLES from forum-mod-gate.js (kept in sync deliberately; do not
// widen without a security review).

import { FORUM_MOD_ROLES } from "./forum-mod-gate.js";

function _authRequired() {
  return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };
}

/**
 * Gate for `collab.run_council`. Returns null when the actor is allowed
 * (internal, session owner — the call site folds the admin check into
 * isSessionOwner — or a moderator-class role via role/roles,
 * case-insensitive); otherwise a denial result the caller must return
 * verbatim. Order matters: internal/owner/mod-role allow first, then
 * signed-in check (401), then everyone else is a plain member (403).
 * Returns a FRESH object on every denial.
 * @param {{ isSessionOwner?: boolean, role?: string, roles?: string[], internal?: boolean, userId?: string }} input
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function collabCouncilDenial(input) {
  const { isSessionOwner, role, roles, internal, userId } = input || {};
  if (internal === true || isSessionOwner === true) return null;
  if (FORUM_MOD_ROLES.has(String(role || "").toLowerCase())) return null;
  if (Array.isArray(roles) && roles.some((r) => FORUM_MOD_ROLES.has(String(r).toLowerCase()))) return null;
  if (!userId || userId === "anon") return _authRequired();
  return { ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the session owner or a moderator can start a council vote" };
}