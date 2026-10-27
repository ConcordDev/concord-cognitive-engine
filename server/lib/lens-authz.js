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

// ── Anonymous-write gate (handler level) ────────────────────────────────────
// The server.js H1 gate refuses anonymous /api/lens/run calls in secured
// production, but the handlers themselves fell back to `actor || "anon"` and
// accepted writes from any caller that reached them another way (MCP, chat
// tools, internal dispatch, a mis-set AUTH_MODE). guardAnonWrites() wraps a
// domain's registrar so every WRITE-shaped action refuses a caller with no real
// account before the handler runs. Read actions (public feeds, directories,
// news, forums, council lists) are untouched and keep their anonymous access.
//
// AUTH_MODE=public (local-first, no login) keeps anonymous writes, matching H1.

export const ANON_WRITE_REFUSAL = Object.freeze({
  ok: false,
  error: "auth_required",
  reason: "auth_required",
  status: 401,
  message: "Sign in to make changes.",
});

const WRITE_SEGMENTS = new Set([
  // the probe's write segments (keep in sync with probe-lens.mjs)
  "create", "add", "post", "save", "update", "delete", "remove", "import", "link", "pay", "send",
  "submit", "set", "record", "ingest", "register", "cancel", "mark",
  "sync", "book", "file",
  // other unambiguous state changes
  "approve", "reject", "assign", "unassign", "complete", "close", "reopen", "archive", "unarchive",
  "invite", "join", "leave", "vote", "comment", "upload", "edit", "rename", "move", "transfer",
  "deposit", "withdraw", "claim", "redeem", "toggle", "publish", "unpublish", "accept", "decline",
  "checkout", "purchase", "buy", "sell", "enroll", "unenroll", "subscribe", "unsubscribe", "upsert",
  "insert", "like", "unlike", "follow", "unfollow", "rsvp", "restore", "duplicate", "clone", "merge",
  "release", "lock", "unlock", "upvote", "downvote", "react", "pin", "unpin", "block", "unblock",
  "mute", "unmute", "dismiss", "resolve", "refund", "void", "settle", "mint", "burn", "stake",
  "unstake", "bid", "unlist",
]);

// Lens actions reached anonymously ON PURPOSE by server.js public routes
// (token/slug-addressed share pages and the welding customer portal).
const ANON_ALLOWED_ACTIONS = new Set([
  "welding.portal-view", "welding.portal-approve",
  "creative.prooflink-public-get", "creative.prooflink-public-comment",
  "events.public-page", "docs.share-public", "experience.share-public",
  "carpentry.portalPublicView", "nonprofit.donation-page-public",
  "animation.share-get", "chat.share-view",
]);

// Verbs that also name pure calculators/template builders ("compute-ratio",
// "generate-outline", "apply-template"). These are gated only when the
// handler source actually persists something; a stateless calculator stays
// open the same way a read does.
const SOFT_WRITE_SEGMENTS = new Set(["compute", "calc", "generate", "apply"]);
const PERSIST_MARKERS = /\.(push|set|delete|splice|unshift|run|add|clear)\s*\(|\b(INSERT|UPDATE|DELETE|REPLACE)\b|\b(save|push|ensure|upsert|append|record|persist|write|store|insert|update|delete|remove|next\w*Id|bump|increment)\w*\s*\(|\+\+|\+=|-=/;

function _segments(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when an action name describes a state change (create/update/delete/…).
 * When `handler` is given, an action whose only write-ish verb is a soft one
 * (compute/calc/generate/apply) counts as a write only if its source persists.
 */
export function isWriteActionName(name, handler) {
  const segs = _segments(name);
  const hits = segs.filter((s) => WRITE_SEGMENTS.has(s) || SOFT_WRITE_SEGMENTS.has(s));
  if (hits.length === 0) return false;
  if (hits.some((s) => !SOFT_WRITE_SEGMENTS.has(s))) return true;
  if (typeof handler !== "function") return true;
  let src = "";
  try { src = Function.prototype.toString.call(handler); } catch { return true; }
  return PERSIST_MARKERS.test(src);
}

function _authModePublic() {
  return String(process.env.AUTH_MODE || "").toLowerCase() === "public";
}

/**
 * Returns the standard refusal when ctx has no real account, else null.
 * Use inside a handler: `const no = refuseAnonWrite(ctx); if (no) return no;`
 */
export function refuseAnonWrite(ctx) {
  if (_authModePublic()) return null;
  return actorId(ctx) ? null : { ...ANON_WRITE_REFUSAL };
}

/**
 * Wrap a domain registrar so WRITE-shaped actions refuse anonymous callers.
 * Idempotent; read actions and ANON_ALLOWED_ACTIONS register unchanged.
 * @param {Function} register - registerLensAction(domain, name, handler, ...rest)
 * @param {{ allow?: string[] }} [opts] - extra action names (bare or domain.name) that stay anonymous
 */
export function guardAnonWrites(register, { allow = [] } = {}) {
  if (typeof register !== "function" || register.__anonWriteGuard) return register;
  const extra = new Set(allow);
  const wrapped = function guardedRegister(domain, name, handler, ...rest) {
    const key = `${domain}.${name}`;
    if (
      typeof handler !== "function"
      || handler.__anonWriteGuard
      || !isWriteActionName(name, handler)
      || ANON_ALLOWED_ACTIONS.has(key)
      || extra.has(name) || extra.has(key)
    ) {
      return register.call(this, domain, name, handler, ...rest);
    }
    const isAsync = handler.constructor && handler.constructor.name === "AsyncFunction";
    const guarded = function (ctx, ...args) {
      const no = refuseAnonWrite(ctx);
      if (no) return isAsync ? Promise.resolve(no) : no;
      return handler.call(this, ctx, ...args);
    };
    Object.assign(guarded, handler);
    guarded.__anonWriteGuard = true;
    guarded.__inner = handler;
    // Source-reading tools (param synthesis, docs) see the real handler.
    guarded.toString = () => Function.prototype.toString.call(handler);
    try { Object.defineProperty(guarded, "name", { value: handler.name || name }); } catch { /* non-configurable */ }
    try { Object.defineProperty(guarded, "length", { value: handler.length }); } catch { /* non-configurable */ }
    return register.call(this, domain, name, guarded, ...rest);
  };
  wrapped.__anonWriteGuard = true;
  return wrapped;
}
