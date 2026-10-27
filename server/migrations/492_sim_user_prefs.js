// Migration 492 — saved world-sim accessibility and settings.
//
// GET /api/world/sim/accessibility and /settings used to return the same
// canned defaults for every user, and POST forgot the body. Rows here are
// the caller's own JSON. An absent row stays absent.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_user_prefs (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('accessibility', 'settings')),
      prefs_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS sim_user_prefs;`);
}
