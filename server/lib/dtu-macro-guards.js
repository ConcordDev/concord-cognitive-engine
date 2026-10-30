/**
 * Guards for DTU macros that historically skipped the read/ownership
 * checks the by-id REST routes already apply (HANDOFF-SEC-2 Fix 8).
 *
 * Three shapes, all returning FRESH denial objects (never a shared
 * frozen object a caller could mutate):
 *
 * - dtuReadDenial: an unreadable DTU is indistinguishable from a
 *   missing one — the handler's own not-found body (404).
 * - credibilityAdminDenial: council.credibility writes an authority
 *   score. That is an admin act on ANY DTU, including the caller's
 *   own — members must never set it.
 * - collabParticipantDenial: collab.lock/unlock act inside a
 *   session. Only participants (or admins/internal callers) may
 *   touch its locks, and the acting id always comes from the ctx,
 *   never from caller-supplied input.
 *
 * Internal callers (ctx.internal / ctx.actor.internal — boot ticks,
 * autogen) are always allowed, matching ctxMayReadDtu and the rest
 * of the SEC series.
 */
import { ctxMayReadDtu } from "./dtu-read-access.js";
import { DTU_ADMIN_ROLES } from "./dtu-ownership.js";

function isInternal(ctx) {
  return ctx?.internal === true || ctx?.actor?.internal === true;
}

function actorHasRole(ctx, roleSet) {
  const role = ctx?.actor?.role;
  if (typeof role === "string" && roleSet.has(role.toLowerCase())) return true;
  const roles = ctx?.actor?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      if (typeof r === "string" && roleSet.has(r.toLowerCase())) return true;
    }
  }
  return false;
}

function realUserId(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.actor?.odId || null;
  if (!id || id === "anon") return null;
  return String(id);
}

const AUTH_REQUIRED = () => ({
  ok: false,
  status: 401,
  code: "AUTH_REQUIRED",
  error: "sign in required",
});

/**
 * null when the caller may read this DTU; otherwise a fresh copy of
 * the not-found body. `mayRead` defaults to ctxMayReadDtu and is
 * injectable for tests. `notFound` lets a handler keep its own
 * existing not-found body so missing and unreadable stay
 * indistinguishable on that surface.
 */
export function dtuReadDenial(ctx, dtu, mayRead = ctxMayReadDtu, notFound = null) {
  if (dtu && mayRead(ctx, dtu)) return null;
  if (notFound) return { ...notFound };
  return { ok: false, status: 404, error: "DTU not found" };
}

/**
 * null for internal callers and admin-role actors; 401 when there
 * is no real signed-in user; 403 for other members.
 */
export function credibilityAdminDenial(ctx) {
  if (isInternal(ctx)) return null;
  if (actorHasRole(ctx, DTU_ADMIN_ROLES)) return null;
  if (!realUserId(ctx)) return AUTH_REQUIRED();
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN",
    error: "forbidden: admin role required",
  };
}

/**
 * null for internal callers, admin-role actors, and session
 * participants; 401 when there is no real actor id; 403 for
 * signed-in non-participants ("join the session first" — collab.join
 * is the open door).
 */
export function collabParticipantDenial(ctx, session, actorId) {
  if (isInternal(ctx)) return null;
  if (actorHasRole(ctx, DTU_ADMIN_ROLES)) return null;
  if (!actorId || actorId === "anon" || actorId === "anonymous") {
    return AUTH_REQUIRED();
  }
  const participants = Array.isArray(session?.participants)
    ? session.participants
    : [];
  if (participants.some((p) => p?.userId === actorId)) return null;
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN",
    error: "forbidden: join the session first",
  };
}
