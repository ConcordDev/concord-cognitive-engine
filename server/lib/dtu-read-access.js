/**
 * By-id DTU read gate.
 *
 * This is the private/user-scoped half of `userVisibleDTUs` in server.js
 * (the filter GET /api/dtus already applies). By-id reads must use the same
 * predicate: a DTU with privacy private/followers-only, scope "user", or
 * visibility "private" is readable only by its owner.
 *
 * Not `canViewDtu` (lib/federation.js). That helper also denies legacy
 * unscoped DTUs the anonymous list still returns, and it grants an
 * admin/owner/founder/sovereign bypass the list does not. Wiring it here
 * would change what public and null-visibility DTUs return.
 *
 * Followers-only matches the list: owner-only. There is no followers-graph
 * check on the list, so by-id reads do not invent one.
 *
 * Server-internal callers (ctx.internal / actor.internal, the makeInternalCtx
 * stamp) bypass this gate. An HTTP request never carries that stamp.
 */

export function privateDtuHiddenFrom(d, viewerId) {
  if (!d || typeof d !== "object") return true;
  const isPrivate =
    d.privacy === "private" ||
    d.privacy === "followers-only" ||
    d.scope === "user" ||
    d.visibility === "private";
  if (!isPrivate) return false;
  const owner = d.author || d.ownerId || d.userId || d.createdBy;
  if (!viewerId) return true;
  return owner !== viewerId;
}

/**
 * Viewer id for a macro ctx or an Express req.
 * Prefers actor.id (what dtu.list uses). Falls back to a real actor.userId
 * so owner-scoped callers that only stamp userId can still read their own
 * DTUs. The makeCtx anonymous placeholder "anon" is not a viewer.
 */
export function viewerIdFromCtx(ctx) {
  if (!ctx) return null;
  const actor = ctx.actor || null;
  const id = actor?.id || actor?.odId || ctx.user?.id || null;
  if (id) return id;
  const uid = actor?.userId || ctx.user?.userId;
  if (uid && uid !== "anon") return uid;
  return null;
}

/** True when this caller may receive the DTU's content. */
export function ctxMayReadDtu(ctx, dtu) {
  if (ctx?.internal === true || ctx?.actor?.internal === true) return true;
  return !privateDtuHiddenFrom(dtu, viewerIdFromCtx(ctx));
}

/**
 * Rebuild a DTU-shaped object from a dtu_store row so the private predicate
 * can run on sqlite-backed reads (export, attachments). `scope` is NOT copied
 * from the column: it defaults to 'global' and would disagree with a missing
 * in-memory scope. Visibility / privacy / owner are filled only when the
 * stored object lacks them.
 */
/**
 * Ids that are not a person. Stamping one of these as ownerId makes the
 * chat consent filter treat the DTU as world-readable (`anon` / `system` /
 * `founder`) or leaves it ownerless (`anonymous`).
 */
const NOT_AN_OWNER = new Set(["anon", "anonymous", "system", "founder"]);

/** A real requesting user, or null when the id is missing or a placeholder. */
export function realDtuOwnerId(userId) {
  if (typeof userId !== "string") return null;
  const id = userId.trim();
  if (!id || NOT_AN_OWNER.has(id)) return null;
  return id;
}

/**
 * Owner + private stamp for a DTU that captures someone's prompt.
 * Null when there is no real user — callers must not persist in that case
 * if the row would otherwise be anonymous-readable.
 */
export function privateOwnerStamp(userId) {
  const owner = realDtuOwnerId(userId);
  if (!owner) return null;
  return {
    ownerId: owner,
    author: owner,
    userId: owner,
    createdBy: owner,
    visibility: "private",
    privacy: "private",
    scope: "user",
  };
}

/**
 * Mark `dtu` private. A real user id also becomes the owner. An existing
 * non-global scope (for example forge `local`) is left alone so list-scope
 * tests keep their contract. Returns false when no real owner was applied.
 */
export function applyPrivateOwner(dtu, userId) {
  if (!dtu || typeof dtu !== "object") return false;
  dtu.visibility = "private";
  dtu.privacy = "private";
  if (!dtu.scope || dtu.scope === "global") dtu.scope = "user";
  const owner = realDtuOwnerId(userId);
  if (!owner) return false;
  dtu.ownerId = owner;
  dtu.author = owner;
  dtu.userId = owner;
  dtu.createdBy = owner;
  return true;
}

export function dtuFromStoreRow(row) {
  if (!row || typeof row !== "object") return null;
  let obj = null;
  if (typeof row.data === "string") {
    try { obj = JSON.parse(row.data); } catch { obj = null; }
  } else if (row.data && typeof row.data === "object") {
    obj = row.data;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
  if (obj.visibility == null && row.visibility) obj.visibility = row.visibility;
  if (obj.privacy == null && row.privacy) obj.privacy = row.privacy;
  if (!obj.ownerId && !obj.author && !obj.userId && !obj.createdBy && row.owner_user_id) {
    obj.ownerId = row.owner_user_id;
  }
  return obj;
}
