// server/migrations/093_multi_avatar.js
//
// v2.0 Workstream 6a: per-user multiple avatars. Each avatar carries its
// own loadout / hotbar / personal-locker scope so a user can keep
// distinct character builds (e.g. melee bruiser vs. spellcaster) and
// switch between them.
//
// Backwards compatibility: existing rows have null avatar_id and are
// treated as belonging to the user's "primary" avatar. The avatars table
// will be backfilled lazily on first login.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS avatars (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_avatars_user ON avatars(user_id);
  `);

  // Add avatar_id columns to user-scoped tables. Nullable so existing rows
  // are interpreted as belonging to the primary avatar.
  for (const table of ["personal_dtus", "player_inventory", "player_equipment"]) {
    try {
      const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
      if (cols.size > 0 && !cols.has("avatar_id")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN avatar_id TEXT`);
      }
    } catch { /* table may not exist in some deployments — skip */ }
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
