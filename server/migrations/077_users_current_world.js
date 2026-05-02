// server/migrations/077_users_current_world.js
// Tracks which world each user is currently in. Used by the Concord Link
// to validate that source_world on /send matches the user's actual location
// (you can't legitimately send a message from a world you're not in), and
// by the cross-world skill effectiveness system to compute multipliers
// against the world the user is actually playing in.
//
// Default 'concordia' — every user starts in the hub.

export function up(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN current_world TEXT NOT NULL DEFAULT 'concordia'`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_world_travel_log (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        from_world    TEXT,
        to_world      TEXT NOT NULL,
        anchor_id     TEXT,
        traveled_at   INTEGER NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_travel_user ON user_world_travel_log(user_id, traveled_at DESC)`);
  } catch (_e) { /* index/table best-effort */ }
}
