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
