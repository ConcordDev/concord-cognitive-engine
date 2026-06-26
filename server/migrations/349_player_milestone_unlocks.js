// server/migrations/349_player_milestone_unlocks.js
//
// Content pillar 3 — lore milestones → ledger. When a player completes a
// legendary task (a quest with a `skill_unlock` / `faction_modifier` reward, or
// an authored lore milestone), the engine stamps an IMMUTABLE record onto their
// character state instead of just showing text. `ref_id` is UNIQUE so the stamp
// is idempotent — re-claiming or replaying the same milestone never double-grants
// (the same ON CONFLICT(ref_id) DO NOTHING pattern the economy ledger uses).
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_milestone_unlocks (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,        -- skill_unlock | faction_modifier | title | ...
      unlock_key  TEXT NOT NULL,        -- skill id / faction id / branch id
      amount      INTEGER,              -- optional magnitude (e.g. faction rep delta)
      source      TEXT,                 -- quest:<id> / achievement:<id> / lore:<eventId>
      ref_id      TEXT NOT NULL UNIQUE, -- idempotency key: one stamp per (source,user,key)
      unlocked_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_milestone_unlocks_user ON player_milestone_unlocks(user_id, kind)`);
}
