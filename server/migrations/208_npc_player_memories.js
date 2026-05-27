// server/migrations/208_npc_player_memories.js
//
// Per-(NPC, player) conversational + behavioral memory. Items 1, 6, 10
// of the revolutionary-RPG arc all need this:
//   - Item 1: NPCs ask questions, remember answers, gossip them
//   - Item 6: AI dialogue prompts include per-user history
//   - Item 10: NPCs grieve absent players who they knew well
//
// Today `npc-asymmetry` carries grudges/preoccupations/desires keyed
// per player but no rolled-up "what happened between us" summary. The
// memory cycle (npc-player-memory-cycle.js) periodically compiles
// `summary_json` from recent interaction events via the subconscious
// brain.
//
// Sentiment is a scalar [-1, +1] that biases dialogue tone + gossip
// propagation weighting.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_player_memories (
      npc_id                    TEXT NOT NULL,
      player_id                 TEXT NOT NULL,
      world_id                  TEXT NOT NULL,
      summary_json              TEXT,           -- compiled by subconscious brain
      sentiment                 REAL NOT NULL DEFAULT 0,   -- [-1, +1]
      sightings                 INTEGER NOT NULL DEFAULT 0,
      interactions              INTEGER NOT NULL DEFAULT 0,  -- excludes proximity-only
      first_met_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      last_summary_compiled_at  INTEGER,
      PRIMARY KEY (npc_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_npm_player
      ON npc_player_memories(player_id, last_interaction_at DESC);

    CREATE INDEX IF NOT EXISTS idx_npm_world
      ON npc_player_memories(world_id, last_interaction_at DESC);

    -- Lightweight append-only event log feeding the memory compiler.
    -- Kept small (90-day TTL via heartbeat) so the compile prompts don't
    -- bloat. Per-row payload caps at ~1KB.
    CREATE TABLE IF NOT EXISTS npc_player_interactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id       TEXT NOT NULL,
      player_id    TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      kind         TEXT NOT NULL,    -- 'spoke'|'answered_question'|'gift'|'fought'|'helped'|'witnessed_atrocity'|'sighting'
      payload_json TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_npi_pair
      ON npc_player_interactions(npc_id, player_id, created_at DESC);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
