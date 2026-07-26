// server/migrations/389_faith_world_id.js
//
// Gap closure: `faiths` (migration 205) had zero world-identity column, so a
// player-founded faith floated free of any of Concord's 10 worlds — no
// mechanical way to say "this is the state religion of Sandrun" or "a
// Concord Link cult." This is pure schema+code plumbing (no content
// authoring) — see server/lib/religion-engine.js#foundFaith for the wiring.
//
// Additive + nullable, matching the idiom in migrations 358/359/366/375/
// 376/380/386: NULL means world-agnostic (the behavior every pre-existing
// row already has, and still has after this migration — byte-identical
// read-back). Guarded no-op on a minimal build without the `faiths` table.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "faiths")) return; // minimal build without the religion tables

  if (!columnExists(db, "faiths", "world_id")) {
    db.exec(`ALTER TABLE faiths ADD COLUMN world_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_faiths_world ON faiths(world_id)`);
}

export function down(db) {
  // Forward-only column add (same rationale as 359/376/380/386's ADD
  // COLUMNs) — additive + nullable + harmless to leave behind. The index is
  // safe to drop.
  db.exec(`DROP INDEX IF EXISTS idx_faiths_world`);
}

export const description = "faiths gains a nullable world_id column so a player-founded faith can be scoped to one of Concord's worlds (NULL = world-agnostic, back-compat for every pre-existing row)";
