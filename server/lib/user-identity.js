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
    const cols = db.prepare("PRAGMA table_info(users)").all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("username")) return empty;
    // display_name is not on the migrated users table. The fragment is the
    // literal column, included only when PRAGMA reports it. The id is bound.
    const display = names.has("display_name") ? ", display_name AS displayName" : "";
    const row = db.prepare(`SELECT username${display} FROM users WHERE id = ?`).get(userId);
    if (!row) return empty;
    const username = row.username || null;
    const displayName = row.displayName || username;
    return { username, displayName };
  } catch {
    return empty;
  }
}
