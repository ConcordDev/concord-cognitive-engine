// server/migrations/108_lattice_train_consent.js
//
// Adds a `train_consented` column to every table that's a candidate
// training-data source for the future Lattice (6th) brain.
//
// Two consent regimes:
//
//   USER-AUTHORED CONTENT (default 0 = NOT consented).
//   The user must explicitly opt in. UI toggles flip this to 1.
//   - dtus (user-authored knowledge)
//   - culture_resonance (rows carry user_id → PII)
//
//   PLATFORM-GENERATED CONTENT (default 1 = consented).
//   The platform authored these as part of normal simulation; they
//   contain no user-attributed authorship beyond the user-action that
//   triggered a deterministic platform response. Selective redaction
//   is still possible by flipping the flag to 0 per-row.
//   - world_events_log (kingdom foundings, tournament outcomes, etc.)
//   - evo_assets (creature/item/skill blueprints — most platform, some
//                 player-crafted but those carry only system-actor refs)
//   - evo_asset_interactions (system+user interaction records)
//   - damage_events (combat hits — physics simulation outcomes)
//   - minigame_events (basketball/racing play-by-play)
//   - opinion_events (NPC opinion shifts — NPCs are platform actors)
//   - creature_corpses (world state)
//   - world_facts (NPC-dialogue-referenceable facts)
//
// Adding a quality score column on dtus too — we'll use this later to
// filter low-quality DTUs out of training without manual curation.
//
// Why this matters: every row added between this migration and the
// Lattice brain ship date is already correctly tagged. No retroactive
// consent prompts, no scrambling to figure out who opted into what.

const USER_AUTHORED_TABLES = [
  ["dtus", true],              // [name, addQualityScore]
  ["culture_resonance", false],
];

const PLATFORM_TABLES = [
  "world_events_log",
  "evo_assets",
  "evo_asset_interactions",
  "damage_events",
  "minigame_events",
  "opinion_events",
  "creature_corpses",
  "world_facts",
];

export function up(db) {
  // User-authored: default 0 (not consented; explicit opt-in required).
  for (const [name, addQuality] of USER_AUTHORED_TABLES) {
    if (!_tableExists(db, name)) continue;
    if (!_columnExists(db, name, "train_consented")) {
      db.exec(`ALTER TABLE ${name} ADD COLUMN train_consented INTEGER NOT NULL DEFAULT 0`);
    }
    if (addQuality && !_columnExists(db, name, "train_quality_score")) {
      db.exec(`ALTER TABLE ${name} ADD COLUMN train_quality_score REAL`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_train ON ${name}(train_consented) WHERE train_consented = 1`);
  }

  // Platform-generated: default 1 (consented by default since platform
  // authored these). Existing rows backfill to 1 via the column default.
  for (const name of PLATFORM_TABLES) {
    if (!_tableExists(db, name)) continue;
    if (!_columnExists(db, name, "train_consented")) {
      db.exec(`ALTER TABLE ${name} ADD COLUMN train_consented INTEGER NOT NULL DEFAULT 1`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_train ON ${name}(train_consented) WHERE train_consented = 1`);
  }
}

function _tableExists(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function _columnExists(db, table, col) {
  // pragma_table_info returns one row per column; check for ours.
  const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table);
  return rows.some((r) => r.name === col);
}
