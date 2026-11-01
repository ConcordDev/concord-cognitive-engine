// Case-insensitive user lookup by email.
//
// Sign-up now stores lower-cased addresses, but legacy rows keep whatever case
// they were registered with. An exact `email = ?` match therefore misses a
// legacy "Bob@X.com" row when "bob@x.com" is looked up (sign-up duplicate check,
// login, password reset). Exact match is tried first (index-backed, and the
// right row if two case-variants ever coexist); lower() compare is the fallback.

const COLS = "id, username, email, password_hash, role, scopes, created_at, last_login_at";

export function findActiveUserRowByEmail(db, email) {
  if (typeof email !== "string" || !email) return null;
  const exact = db.prepare(`SELECT ${COLS} FROM users WHERE email = ? AND is_active = 1`).get(email);
  if (exact) return exact;
  // Oldest account wins if legacy data holds several case-variants of one address.
  return db.prepare(
    `SELECT ${COLS} FROM users WHERE lower(email) = lower(?) AND is_active = 1 ORDER BY created_at ASC LIMIT 1`
  ).get(email) || null;
}

export function emailsMatchIgnoreCase(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}
