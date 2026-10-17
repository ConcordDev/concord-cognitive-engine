// server/lib/lens-authz.js
//
// Tiny, pure authorization helpers used by lens domains and libraries.
// Refusals are returned as { ok: false, reason: ... } objects; callers decide
// whether to throw or return.

const ADMIN_ROLES = new Set(["admin", "owner", "founder"]);

// Placeholder identities the HTTP layer assigns to unauthenticated callers
// (getActorFromReq gives anonymous requests userId "anon"). They must never
// count as a real account for ownership checks.
const ANON_IDS = new Set(["anon", "anonymous", "guest"]);

export function actorId(ctx) {
  const id = ctx?.actor?.userId || ctx?.userId || null;
  if (id == null) return null;
  const s = String(id);
  return ANON_IDS.has(s.toLowerCase()) ? null : s;
}

export function isAdmin(ctx) {
  if (ctx?.actor?.isAdmin) return true;
  const role = ctx?.actor?.role;
  return typeof role === "string" && ADMIN_ROLES.has(role.toLowerCase());
}

export function requireActor(ctx) {
  const id = actorId(ctx);
  if (!id) return { ok: false, reason: "auth_required" };
  return { ok: true, actorId: id };
}

export function requireOwner(ctx, ownerId) {
  const auth = requireActor(ctx);
  if (!auth.ok) return auth;
  if (auth.actorId === String(ownerId || "")) return { ok: true, actorId: auth.actorId };
  if (isAdmin(ctx)) return { ok: true, actorId: auth.actorId };
  return { ok: false, reason: "forbidden" };
}
