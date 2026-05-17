// server/migrations/202_agent_marketplace_indexes.js
//
// Phase 13 (Stage C) — agent marketplace schema additions + query indexes.
//
// The agent marketplace writes `kind='agent_spec'` DTUs with meta_json
// metadata. Migration 001's canonical `dtus` schema doesn't include
// `kind` or `meta_json` (migration 087 added `type` + `creator_id` +
// `data` aliases for similar reasons but missed these two). Without
// adding them here, the agent.mint macro silently fails in production
// with "table dtus has no column named kind".
//
// This same column-shape is also used by forge-marketplace.js,
// glyph-spells.js, mentorship.js, npc-persona.js, npc-autobiography.js,
// and the artifact-creation pipeline — so this migration is load-bearing
// for more than just the agent marketplace.
//
// Found by running the dev server end-to-end (Phase 13 launch-prep).

export function up(db) {
  // ── Step 1: add column aliases if missing ─────────────────────────────
  // Mirror the migration-087 pattern (`type` + `creator_id` + `data`).
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("kind")) {
      db.exec("ALTER TABLE dtus ADD COLUMN kind TEXT");
      // Backfill from `type` so existing rows show up under kind queries.
      try { db.exec("UPDATE dtus SET kind = type WHERE kind IS NULL AND type IS NOT NULL"); }
      catch { /* best-effort */ }
    }
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }

  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("meta_json")) {
      db.exec("ALTER TABLE dtus ADD COLUMN meta_json TEXT");
      try { db.exec("UPDATE dtus SET meta_json = data WHERE meta_json IS NULL AND data IS NOT NULL"); }
      catch { /* best-effort */ }
    }
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }

  // Defensive: skill_level + total_experience also referenced by
  // forge-marketplace / glyph-spells INSERTs. Present in live schema as of
  // earlier migrations but ensure they exist for older deploys too.
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    if (!cols.has("skill_level")) {
      db.exec("ALTER TABLE dtus ADD COLUMN skill_level REAL DEFAULT 1");
    }
    if (!cols.has("total_experience")) {
      db.exec("ALTER TABLE dtus ADD COLUMN total_experience REAL DEFAULT 0");
    }
  } catch (e) {
    if (!e?.message?.includes("duplicate column name")) throw e;
  }

  // ── Step 2: query indexes for the agent marketplace ───────────────────
  // Partial indexes require the kind column to exist, hence step 1 first.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dtus_agent_spec_by_creator
      ON dtus(creator_id, created_at DESC) WHERE kind = 'agent_spec';
    CREATE INDEX IF NOT EXISTS idx_dtus_agent_spec_newest
      ON dtus(created_at DESC) WHERE kind = 'agent_spec';
    CREATE INDEX IF NOT EXISTS idx_dtus_kind
      ON dtus(kind);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_dtus_kind;
    DROP INDEX IF EXISTS idx_dtus_agent_spec_newest;
    DROP INDEX IF EXISTS idx_dtus_agent_spec_by_creator;
  `);
  // sqlite — leave columns in place (alias columns; safe to keep)
}
