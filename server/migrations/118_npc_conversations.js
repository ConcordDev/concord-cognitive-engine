// Layer 13 — NPC-initiated conversations.
// One row per (world, ordered NPC pair, opened_at). The cycle creates rows
// during the npc-conversation-initiator heartbeat; cooldown logic keys off
// last opened_at per (world, pair).
//
// Schema:
//   - npc_a / npc_b are sorted lexicographically at insert (idx_pair),
//     keeping cooldown queries pair-symmetric.
//   - messages_json holds the dialogue as a single JSON array; the cycle
//     only writes the opener, but follow-on rounds (player-driven or
//     subsequent ticks) append in place.
//   - status: 'active' while expires_at > now, then 'closed'.
//   - seed_context_json carries the grounded fragments used to generate
//     the opener (faction tags, shared world events, recent damage, etc.)
//     so future passes can reference + extend without re-deriving.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_conversations (
      id                  TEXT PRIMARY KEY,
      world_id            TEXT NOT NULL,
      npc_a               TEXT NOT NULL,
      npc_b               TEXT NOT NULL,
      opened_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      last_msg_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at          INTEGER NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      composer            TEXT NOT NULL DEFAULT 'deterministic',
      seed_context_json   TEXT NOT NULL DEFAULT '{}',
      messages_json       TEXT NOT NULL DEFAULT '[]',
      CHECK (npc_a < npc_b),
      CHECK (status IN ('active', 'closed'))
    );
    CREATE INDEX IF NOT EXISTS idx_npc_conv_world ON npc_conversations(world_id, opened_at);
    CREATE INDEX IF NOT EXISTS idx_npc_conv_pair  ON npc_conversations(world_id, npc_a, npc_b, opened_at);
    CREATE INDEX IF NOT EXISTS idx_npc_conv_active ON npc_conversations(world_id, status, expires_at);
  `);
}

export function down(_db) { /* SQLite — leave the table in place */ }
