// server/migrations/087_dtus_type_column.js
// Several lib modules (skill-atrophy, nemesis, npc-simulator, skill-interaction,
// substrate-diffusion, npc-behaviors) query `dtus.type` to filter skills,
// materials, items, etc. The migration-001 schema for `dtus` doesn't include
// a `type` column — those queries silently fail every tick. This migration
// adds the column and creates an index so the queries work.
//
// Existing rows are backfilled to 'knowledge' (the most common default).
// New rows that came in via INSERT INTO dtus (type, ...) calls already
// have it set, so this is purely additive.

export function up(db) {
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("type")) {
      db.exec("ALTER TABLE dtus ADD COLUMN type TEXT NOT NULL DEFAULT 'knowledge'");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_dtus_type ON dtus(type)");
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }

  // creator_id alias — many lib modules query `creator_id` against a table
  // that uses `owner_user_id`. Add it as a stored column and backfill from
  // owner_user_id so the rest of the code stops getting "no such column".
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("creator_id")) {
      db.exec("ALTER TABLE dtus ADD COLUMN creator_id TEXT");
      try { db.exec("UPDATE dtus SET creator_id = owner_user_id WHERE creator_id IS NULL"); }
      catch { /* best-effort */ }
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_dtus_creator ON dtus(creator_id)");
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }

  // data column — several writers (skill-progression.recordGameplayXP,
  // starter-content recipes) INSERT INTO dtus (id, type, title, creator_id, data, ...).
  // The migration-001 schema uses `body_json`. Add `data` as an alias.
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("data")) {
      db.exec("ALTER TABLE dtus ADD COLUMN data TEXT");
      try { db.exec("UPDATE dtus SET data = body_json WHERE data IS NULL AND body_json IS NOT NULL"); }
      catch { /* best-effort */ }
    }
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }
}

export function down(_db) { /* sqlite — leave columns in place */ }
