// Migration 144 — Concordia Procedural Mount System Phase B3: gear.
//
// Saddles, bridles, barding modify mount stats. Authored as v2.0 recipe
// DTUs with `kind='mount_gear'` (validated in lib/dtu-validators/
// mount-gear-validators.js) and equipped on player_companions via
// the new slot columns added here.
//
// CLAUDE.md invariant added by this phase:
//   `mount_gear` is a DTU kind under the v2.0 recipe substrate
//   (alongside fighting_style_recipe, spell_recipe, blueprint). Slot
//   field is required and one of {saddle, bridle, barding}. Schema is
//   append-only — existing 3 recipe kinds untouched.
//
// Schema extension on `player_companions` (idempotent re-run safe):
//   saddle_dtu_id  TEXT NULL
//   bridle_dtu_id  TEXT NULL
//   barding_dtu_id TEXT NULL

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
  if (!cols.includes("saddle_dtu_id")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN saddle_dtu_id TEXT`);
  }
  if (!cols.includes("bridle_dtu_id")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN bridle_dtu_id TEXT`);
  }
  if (!cols.includes("barding_dtu_id")) {
    db.exec(`ALTER TABLE player_companions ADD COLUMN barding_dtu_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_saddle ON player_companions(saddle_dtu_id) WHERE saddle_dtu_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_bridle ON player_companions(bridle_dtu_id) WHERE bridle_dtu_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_companions_barding ON player_companions(barding_dtu_id) WHERE barding_dtu_id IS NOT NULL`);
}

export function down(_db) { /* forward-only */ }
