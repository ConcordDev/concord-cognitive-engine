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
    const row = db.prepare(
      "SELECT username, display_name AS displayName FROM users WHERE id = ?",
    ).get(userId);
    if (!row) return empty;
    const username = row.username || null;
    const displayName = row.displayName || username;
    return { username, displayName };
  } catch {
    try {
      const row = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
      if (!row || !row.username) return empty;
      return { username: row.username, displayName: row.username };
    } catch {
      return empty;
    }
  }
}
