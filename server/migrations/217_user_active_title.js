// server/migrations/217_user_active_title.js
//
// Phase U3 — surface the equipped title on the user row so the friends
// panel + NPC dialogue greeting + tournament brackets can display
// "Marcus the Healer" instead of just "Marcus" without a join.
//
// Idempotent: best-effort ALTER that tolerates minimal builds where
// the users table doesn't exist.

export function up(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN active_title_id TEXT NULL;`);
  } catch (err) {
    // Column already exists OR users table missing on minimal builds.
    // Both are fine — the title equip code path tolerates either case.
    if (!String(err?.message || "").includes("duplicate column")) {
      // Re-throw only on truly unexpected errors.
      if (!String(err?.message || "").includes("no such table")) {
        throw err;
      }
    }
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_active_title ON users(active_title_id);`);
  } catch { /* index optional */ }
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN in older versions; leaving as-is is fine.
  try { db.exec(`DROP INDEX IF EXISTS idx_users_active_title;`); } catch { /* idempotent */ }
}
