// Migration 139 — Phase 7: Procedural NPC Generator.
//
// Each faction has a psychological profile (a distribution over personality
// dimensions). The generator samples from the distribution + faction-flavored
// name pools + life-event templates to produce NPCs that feel grounded
// within their faction but vary individually. Generated NPCs plug into
// every existing substrate: Phase 2 (asymmetry seeded by archetype +
// faction), Phase 4a (schedule via archetype routing), Phase 4b (economy),
// Phase 5b (legacy + heir resolution via npc_relations + faction-mate
// fallback), Phase 1.5 (marketplace participation by archetype).
//
// Tables:
//   procedural_npcs — one row per generated NPC, persisted alongside
//                     world_npcs. Generation seed + faction-derived
//                     personality vector recorded so reruns produce the
//                     same NPC and so debug tooling can audit lineage.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS procedural_npcs (
      npc_id              TEXT    PRIMARY KEY,
      faction             TEXT    NOT NULL,
      world_id            TEXT    NOT NULL,
      generation_seed     TEXT    NOT NULL,
      personality_vector  TEXT    NOT NULL,
      life_events_json    TEXT,
      generated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pn_faction ON procedural_npcs(faction);
    CREATE INDEX IF NOT EXISTS idx_pn_world   ON procedural_npcs(world_id);
  `);
}

export function down(_db) { /* forward-only */ }
