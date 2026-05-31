// server/migrations/308_player_reputation.js
//
// Slice-of-Life SL3 — public/district reputation. Actions today hit individual
// NPCs (character_opinions); this aggregates them into a player's standing per
// scope (faction | world | district), so a betrayal colors a whole faction's
// regard, not just the one NPC — the BG3 "guardrail" pattern + a legibility
// surface dialogue can read. Derived (recomputed from the opinion/grudge
// stream), so it's a cache; append-only schema. Behind CONCORD_REPUTATION.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_reputation (
      user_id      TEXT NOT NULL,
      scope_kind   TEXT NOT NULL CHECK (scope_kind IN ('faction','world','district')),
      scope_id     TEXT NOT NULL,
      standing     REAL NOT NULL DEFAULT 0,   -- -100..+100, aggregated
      sample_count INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, scope_kind, scope_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_reputation_user ON player_reputation(user_id);
  `);
}
