/**
 * Public name for a user id.
 *
 * username is the @handle. displayName prefers display_name, then username.
 * Missing table or column returns nulls. This never invents a name from the
 * raw id — callers that only have an id leave the handle blank.
 */
export function lookupUserIdentity(db, userId) {
  const empty = { username: null, displayName: null };
  if (!db || !userId || typeof db.prepare !== "function") return empty;
  try {
    // display_name is not on the migrated users table. The fragment is the
    // literal column, included only when PRAGMA reports it. The id is bound.
    // A stub that only implements prepare().get() (no .all()) still answers
    // the username select — skipping introspection must not look like a miss.
    let display = "";
    const info = db.prepare("PRAGMA table_info(users)");
    if (info && typeof info.all === "function") {
      const cols = info.all() || [];
      const names = new Set(cols.map((c) => c && c.name).filter(Boolean));
      if (!names.has("username")) return empty;
      if (names.has("display_name")) display = ", display_name AS displayName";
    }
    const row = db.prepare(`SELECT username${display} FROM users WHERE id = ?`).get(userId);
    if (!row) return empty;
    const username = row.username || null;
    const displayName = row.displayName || username;
    return { username, displayName };
  } catch {
    return empty;
  }
}

/**
 * The bridge-actor guarantee (close-out A12, Message F1): an actor the
 * bridge constructs for a real account carries that account's resolved
 * identity, so a domain stamp never has to trust a client-passed name or
 * fall back to the raw user id for want of the actor's own. Resolution is
 * lookupUserIdentity's — nulls when the account does not resolve, never
 * invented from the id. Anonymous, internal/system, and already-identified
 * actors pass through untouched (the same object back).
 */
export function enrichActorIdentity(db, actor) {
  if (!actor || typeof actor !== "object") return actor;
  const userId = actor.userId;
  if (!userId || userId === "anon" || actor.internal) return actor;
  if (actor.displayName) return actor;
  const { username, displayName } = lookupUserIdentity(db, userId);
  if (!username && !displayName) return actor;
  return {
    ...actor,
    username: actor.username || username || null,
    displayName: displayName || username || null,
  };
}
