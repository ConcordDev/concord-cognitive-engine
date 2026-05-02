// server/migrations/074_quest_archetype_history.js
// Wave 1 deferral 9 — per-user quest archetype history for variety biasing.
// Each row tracks how many times a user has seen a given quest archetype +
// when they last saw it. Quest-emergence biases new generation toward
// unseen archetypes.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_quest_archetypes (
        user_id      TEXT NOT NULL,
        archetype    TEXT NOT NULL,
        seen_count   INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, archetype)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uqa_user ON user_quest_archetypes(user_id, seen_count)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
