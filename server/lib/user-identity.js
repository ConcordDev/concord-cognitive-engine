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
 * Resolve a person reference — a user id, an @username, or the display
 * name the platform itself shows — to the account it names.
 *
 * Returns { userId, username, displayName } on success, or { error }
 * where the error distinguishes the failure modes a caller must not
 * collapse: "unknown user" (looked, nobody by that reference),
 * "user lookup unavailable" (no directory to look in), and an ambiguity
 * message for a display name shared by more than one account (the
 * remedy — use the @username — is named in the message). A leading "@"
 * is accepted on handles. This is the shared resolver the Alliance
 * invite fix and the Productivity collaborate fix both point at.
 */
export function resolveUserByHandle(db, handle) {
  const raw = String(handle == null ? "" : handle).trim().replace(/^@/, "");
  if (!raw) return { error: "unknown user" };
  if (!db || typeof db.prepare !== "function") return { error: "user lookup unavailable" };
  let hasDisplay = false;
  let hasActive = false;
  try {
    const info = db.prepare("PRAGMA table_info(users)");
    if (info && typeof info.all === "function") {
      const names = new Set((info.all() || []).map((c) => c && c.name).filter(Boolean));
      if (!names.has("username")) return { error: "user lookup unavailable" };
      hasDisplay = names.has("display_name");
      hasActive = names.has("is_active");
    }
  } catch {
    return { error: "user lookup unavailable" };
  }
  const act = hasActive ? " AND is_active = 1" : "";
  const cols = hasDisplay ? "id, username, display_name" : "id, username";
  const named = (row) => (row ? {
    userId: row.id,
    username: row.username || null,
    displayName: row.display_name || row.username || null,
  } : null);
  const get = (sql, v) => {
    const stmt = db.prepare(sql);
    return typeof stmt.get === "function" ? stmt.get(v) : null;
  };
  const all = (sql, v) => {
    const stmt = db.prepare(sql);
    if (typeof stmt.all === "function") return stmt.all(v) || [];
    const one = typeof stmt.get === "function" ? stmt.get(v) : null;
    return one ? [one] : [];
  };
  try {
    let hit = named(get(`SELECT ${cols} FROM users WHERE id = ?${act}`, raw));
    if (hit) return hit;
    hit = named(get(`SELECT ${cols} FROM users WHERE username = ?${act}`, raw));
    if (hit) return hit;
    hit = named(get(`SELECT ${cols} FROM users WHERE lower(username) = lower(?)${act}`, raw));
    if (hit) return hit;
    if (hasDisplay) {
      const exact = all(`SELECT ${cols} FROM users WHERE display_name = ?${act}`, raw);
      if (exact.length === 1) return named(exact[0]);
      if (exact.length > 1) return { error: "that name matches more than one account — use their @username instead" };
      const ci = all(`SELECT ${cols} FROM users WHERE lower(display_name) = lower(?)${act}`, raw);
      if (ci.length === 1) return named(ci[0]);
      if (ci.length > 1) return { error: "that name matches more than one account — use their @username instead" };
    }
    return { error: "unknown user" };
  } catch {
    return { error: "user lookup unavailable" };
  }
}
