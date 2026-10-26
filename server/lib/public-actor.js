/**
 * Public stand-in for an account id on a shared payload.
 *
 * Raw user ids stay on the stored row. A viewer who is that account still
 * receives the id (owner UI equality checks). Everyone else gets isMine
 * plus a display handle. The handle is never the raw id: a real name from
 * the actor or the users table, otherwise the caller's role label.
 */
import { lookupUserIdentity } from "./user-identity.js";

export function publicActor(ctx, viewerId, rawId, label = "Member") {
  const id = rawId == null ? "" : String(rawId);
  const mine = id !== "" && String(viewerId || "") === id;
  let displayName = "";
  const actor = ctx?.actor;
  if (mine && actor) {
    const fromActor = String(actor.displayName || actor.username || "").trim();
    if (fromActor && fromActor !== id) displayName = fromActor.slice(0, 80);
  }
  if (!displayName && id) {
    try {
      const db = ctx?.db || globalThis._concordSTATE?.db || globalThis._concordDB || null;
      const ident = lookupUserIdentity(db, id);
      const fromDb = String(ident?.displayName || ident?.username || "").trim();
      if (fromDb && fromDb !== id) displayName = fromDb.slice(0, 80);
    } catch { /* name lookup is best-effort */ }
  }
  return {
    isMine: mine,
    displayName: displayName || label,
    ...(mine && id ? { userId: id } : {}),
  };
}

/**
 * Shallow copy of a response row. Drops `field` unless the viewer is that
 * account, and adds isMine + a display handle.
 */
export function presentOwnedId(ctx, viewerId, row, field, {
  label = "Member",
  nameKey = "displayName",
  mineKey = "isMine",
} = {}) {
  if (!row || typeof row !== "object") return row;
  const card = publicActor(ctx, viewerId, row[field], label);
  const out = { ...row };
  if (!card.isMine) delete out[field];
  out[mineKey] = card.isMine;
  out[nameKey] = card.displayName;
  return out;
}
