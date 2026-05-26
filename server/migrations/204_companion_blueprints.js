// server/migrations/204_companion_blueprints.js
//
// Adds the procedural-creature blueprint JSON to player_companions so a
// tamed creature carries its body topology + mass + skills with it even
// after the source world_npcs row is removed. Without this, a tamed
// hybrid would lose its 3D mesh after taming.
//
// Also adds a `source_kind` column tracking the original entity type
// the companion came from ('world_npc' | 'hybrid' | 'bred') so callers
// can route correctly to the right rendering / lineage path.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
  if (!cols.includes("blueprint_json")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN blueprint_json TEXT`);
  }
  if (!cols.includes("source_kind")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'world_npc'`);
  }
  if (!cols.includes("source_ref")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN source_ref TEXT`);
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
