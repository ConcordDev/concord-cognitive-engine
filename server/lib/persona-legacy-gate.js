/**
 * Legacy persona macro gate (HANDOFF-SEC-2 Fix 9).
 *
 * The canonical `persona.*` macros in server.js (store:
 * STATE.customPersonas, aliased to `personas.*` for lens callers)
 * had no ownership at all:
 * - create stored no owner and accepted a free systemPrompt from
 *   anyone;
 * - list returned every user's custom personas INCLUDING their
 *   systemPrompt to any caller;
 * - update/delete let any member rewrite or delete any user's
 *   persona (name, style, traits, systemPrompt);
 * - PUT /api/personas/:id mutated the GLOBAL agent persona roster
 *   (customInstructions/active/name every user's agent uses) with
 *   no auth check in the handler at all.
 *
 * Rules (guards live INSIDE the handlers, so the plural alias —
 * which copies the registered fn — inherits them):
 * - create: a real signed-in user is required (401 otherwise,
 *   internal callers excepted) and the record is stamped
 *   ownerId = the caller's user id.
 * - update/delete: the owner, an admin-class role, or an internal
 *   caller. Legacy records with no ownerId are admin-only (the
 *   webhook-fix precedent). Unknown id keeps the handlers' existing
 *   404; an existing persona that is not yours is 403.
 * - list: built-ins + the caller's own custom personas; admin-class
 *   and internal callers see all. Another user's systemPrompt is
 *   therefore never in a member's list.
 * - get (the Z4 thin wrapper over the same store): the record is
 *   returned with systemPrompt REMOVED unless the caller owns it
 *   or is admin/internal.
 * - roster PUT: admin-class only (401 anon, 403 member) — editing
 *   the built-in roster is an operator function.
 *
 * Denials are fresh objects in the SEC §1 shapes.
 */
import { DTU_ADMIN_ROLES } from "./dtu-ownership.js";

function isInternal(ctx) {
  return ctx?.internal === true || ctx?.actor?.internal === true;
}

function actorUserId(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || null;
  if (!id || id === "anon") return null;
  return String(id);
}

function isAdminClass(ctx) {
  const role = ctx?.actor?.role;
  if (typeof role === "string" && DTU_ADMIN_ROLES.has(role.toLowerCase())) {
    return true;
  }
  const roles = ctx?.actor?.roles;
  if (Array.isArray(roles)) {
    return roles.some(
      (r) => typeof r === "string" && DTU_ADMIN_ROLES.has(r.toLowerCase()),
    );
  }
  return false;
}

function authRequired() {
  return {
    ok: false,
    status: 401,
    code: "AUTH_REQUIRED",
    error: "sign in required",
  };
}

function forbidden(error) {
  return { ok: false, status: 403, code: "FORBIDDEN", error };
}

/** Facts the handlers and tests need about a caller. */
export function personaActor(ctx) {
  return {
    userId: actorUserId(ctx),
    isAdmin: isAdminClass(ctx),
    internal: isInternal(ctx),
  };
}

/** create: signed-in user (or internal) required. */
export function personaCreateDenial(ctx) {
  const a = personaActor(ctx);
  if (a.internal || a.userId) return null;
  return authRequired();
}

/**
 * update/delete: owner, admin-class or internal. Legacy ownerless
 * records are admin-only. Call only AFTER the existence check —
 * unknown ids keep the handlers' existing 404.
 */
export function personaModifyDenial(ctx, persona) {
  const a = personaActor(ctx);
  if (a.internal || a.isAdmin) return null;
  if (!a.userId) return authRequired();
  if (!persona?.ownerId) return forbidden("forbidden: admin role required");
  if (persona.ownerId === a.userId) return null;
  return forbidden("forbidden: persona belongs to another user");
}

/** May this caller see this custom persona in list results at all? */
export function personaListVisible(ctx, persona) {
  const a = personaActor(ctx);
  if (a.internal || a.isAdmin) return true;
  if (!a.userId) return false;
  return !!persona?.ownerId && persona.ownerId === a.userId;
}

/** May this caller see the persona's systemPrompt? */
export function personaPromptVisible(ctx, persona) {
  const a = personaActor(ctx);
  if (a.internal || a.isAdmin) return true;
  return !!a.userId && !!persona?.ownerId && persona.ownerId === a.userId;
}

/** PUT /api/personas/:id — the global roster is operator-edited. */
export function personaRosterPutDenial(ctx) {
  const a = personaActor(ctx);
  if (a.internal || a.isAdmin) return null;
  if (!a.userId) return authRequired();
  return forbidden("forbidden: admin role required");
}
