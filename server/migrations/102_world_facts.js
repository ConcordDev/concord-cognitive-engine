// server/migrations/102_world_facts.js
//
// world_facts — TTL-bounded shared facts about world state. NPCs,
// procedural generators, and coherence checks all read from here so
// they have a *shared* truth about what happened recently. Pre-this
// table, NPC A and NPC B could independently generate dialogue that
// disagreed about yesterday's events; with shared facts they can't.
//
// Bounded TTL prevents the table from growing unbounded. Each fact has
// an `expires_at` epoch second; reads scope WHERE expires_at > unixepoch().
// Default TTL when not specified is 24 hours.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_facts (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      fact_kind    TEXT NOT NULL,           -- 'event', 'sighting', 'rumor', 'death', 'arrival', etc.
      fact_text    TEXT NOT NULL,           -- short human-readable
      tags_json    TEXT NOT NULL DEFAULT '[]',
      source_user  TEXT,                    -- creator if any (null for system-generated)
      source_npc   TEXT,                    -- originating NPC if any
      faction_id   TEXT,                    -- faction context if applicable
      district_id  TEXT,                    -- where the fact is rooted
      recorded_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER NOT NULL         -- when to stop surfacing this fact
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_facts_world_expires ON world_facts(world_id, expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_facts_world_kind ON world_facts(world_id, fact_kind)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_facts_faction ON world_facts(faction_id) WHERE faction_id IS NOT NULL`);
}

export function down(_db) {
  // SQLite < 3.35 can't DROP COLUMN; we leave the table on rollback.
  // A follow-up migration can drop it explicitly if needed.
}
