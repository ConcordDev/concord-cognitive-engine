// server/migrations/239_npc_mentor_profiles.js
//
// Phase BC2 — NPC mentor registry.
//
// mentorship.js (mig 127) has the full substrate to request/complete
// mentorship sessions. What's missing is the "this NPC IS a mentor"
// surface — there's no registry, so the world lens can't show a
// crown badge above mentor NPCs.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_mentor_profiles (
      npc_id          TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      skill_category  TEXT NOT NULL,
      depth           INTEGER NOT NULL DEFAULT 1,
      fee_cc          REAL NOT NULL DEFAULT 0,
      languages_json  TEXT,
      available       INTEGER NOT NULL DEFAULT 1,
      registered_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      promoted_from   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_npc_mentor_world
      ON npc_mentor_profiles(world_id, available);
    CREATE INDEX IF NOT EXISTS idx_npc_mentor_category
      ON npc_mentor_profiles(skill_category);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_npc_mentor_category;
    DROP INDEX IF EXISTS idx_npc_mentor_world;
    DROP TABLE IF EXISTS npc_mentor_profiles;
  `);
}
