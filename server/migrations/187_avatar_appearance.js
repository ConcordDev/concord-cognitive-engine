// server/migrations/187_avatar_appearance.js
//
// Phase E1 — persistent appearance per avatar. Adds `appearance_json`
// to the `avatars` table (mig 093) so a player's character creator
// choices survive across sessions + worlds. The frontend's
// character-schema.RichAppearanceConfig serialises directly into
// this column.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(avatars)").all().map(c => c.name);
  if (!cols.includes("appearance_json")) {
    try { db.exec(`ALTER TABLE avatars ADD COLUMN appearance_json TEXT`); }
    catch (e) { if (!String(e?.message).includes("duplicate column")) throw e; }
  }
  // For users without a multi-avatar row, also support direct
  // user-level appearance via users.appearance_json (best-effort).
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes("appearance_json")) {
      db.exec(`ALTER TABLE users ADD COLUMN appearance_json TEXT`);
    }
  } catch { /* users table optional in some deployments */ }
}

export function down(_db) {
  // Forward-only.
}
