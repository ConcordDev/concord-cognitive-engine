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
 * Prefers actor.id (what dtu.list uses). Falls back to actor.userId.
 * That fallback includes the public-mode placeholder "anon": dtu.create
 * stamps the same userId onto ownerId, and the local-first anonymous
 * identity has to be able to read the private DTU it just created.
 * A member-owned DTU stays hidden, because its ownerId is a real user id.
 * dtu.list still passes actor.id (null when the caller is anonymous) into
 * userVisibleDTUs, so the list does not gain anon-owned private rows.
 */
export function viewerIdFromCtx(ctx) {
  if (!ctx) return null;
  const actor = ctx.actor || null;
  const id = actor?.id || actor?.odId || ctx.user?.id || null;
  if (id) return id;
  const uid = actor?.userId || ctx.user?.userId;
  if (uid) return uid;
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
