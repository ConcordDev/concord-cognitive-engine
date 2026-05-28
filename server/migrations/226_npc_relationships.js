// server/migrations/226_npc_relationships.js
//
// Phase AB — Nemesis-pattern NPC↔NPC graph.
//
// Today's NPC substrate (grudges, opinions, schemes, legacies) is mostly
// NPC→player or NPC→player+faction. NPC↔NPC at scale (rivals, mentors,
// blood-brothers, family enemies) is the missing layer — what makes
// emergent narrative actually emergent. This migration adds the graph
// and the per-event ledger that escalates it.

export function up(db) {
  // The relationship graph itself. Sorted pair on insert so the CHECK
  // constraint enforces (a < b) — same pattern as Layer 11's
  // faction_relations.
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_relationships (
      id                  TEXT PRIMARY KEY,
      world_id            TEXT NOT NULL,
      npc_a_id            TEXT NOT NULL,
      npc_b_id            TEXT NOT NULL,
      kind                TEXT NOT NULL CHECK (kind IN (
        'rival', 'mentor', 'apprentice', 'blood_brother',
        'family_enemy', 'spy', 'bodyguard', 'former_lover',
        'debt_holder'
      )),
      intensity           REAL NOT NULL DEFAULT 0
        CHECK (intensity >= -1 AND intensity <= 1),
      formed_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      last_event_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      formed_from_event   TEXT,
      CHECK (npc_a_id < npc_b_id),
      UNIQUE(npc_a_id, npc_b_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_rel_world ON npc_relationships(world_id);
    CREATE INDEX IF NOT EXISTS idx_npc_rel_a ON npc_relationships(npc_a_id);
    CREATE INDEX IF NOT EXISTS idx_npc_rel_b ON npc_relationships(npc_b_id);
    CREATE INDEX IF NOT EXISTS idx_npc_rel_last ON npc_relationships(last_event_at);
  `);

  // Every escalation gets logged so the village gossip feed has
  // something to render and so decay sweeps know the freshness.
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_relationship_events (
      id                       TEXT PRIMARY KEY,
      relationship_id          TEXT NOT NULL,
      kind                     TEXT NOT NULL,
      summary                  TEXT NOT NULL,
      ts                       INTEGER NOT NULL DEFAULT (unixepoch()),
      witnessed_by_player_id   TEXT,
      FOREIGN KEY (relationship_id) REFERENCES npc_relationships(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_npc_rel_events_rel
      ON npc_relationship_events(relationship_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_npc_rel_events_ts
      ON npc_relationship_events(ts DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_npc_rel_events_ts;
    DROP INDEX IF EXISTS idx_npc_rel_events_rel;
    DROP TABLE IF EXISTS npc_relationship_events;
    DROP INDEX IF EXISTS idx_npc_rel_last;
    DROP INDEX IF EXISTS idx_npc_rel_b;
    DROP INDEX IF EXISTS idx_npc_rel_a;
    DROP INDEX IF EXISTS idx_npc_rel_world;
    DROP TABLE IF EXISTS npc_relationships;
  `);
}
