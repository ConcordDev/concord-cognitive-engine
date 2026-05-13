// server/migrations/173_bloodline_ancestry.js
//
// Concordia Phase 2 — bloodline ancestry substrate.
//
// Adds two tables: npc_ancestry and user_ancestry. Both track a
// primary bloodline ID + a dilution value (0.0 = pure, 1.0 = no
// detectable ancestry). The combat path reads these in
// /api/worlds/:worldId/combat/attack via lib/bloodline-powers.js
// to gate element-coupled damage:
//
//   - matched-pure (dilution < 0.3) → ×1.20 (full bloodline expression)
//   - matched-mild  (0.3 ≤ d < 0.6) → ×1.00 (no bonus or penalty)
//   - matched-heavy (0.6 ≤ d < 0.9) → ×0.60 (weak variant)
//   - matched-faded (d ≥ 0.9)        → refused (bloodline_too_diluted)
//   - mismatched                      → ×0.85 (off-bloodline element)
//   - no ancestry row                 → ×1.00 (no ancestry data; baseline)
//
// `dilution` defaults to 1.0 (fully diluted / unknown) — only authored
// or explicitly-set rows get pure values. Migration is forward-only;
// authored seed comes from content/world/**/npcs.json via the
// content-seeder (Phase 14 territory, not this PR).
//
// Bloodline IDs are slug-strings matching faction IDs in
// content/world/**/factions.json so the substrate reads as one with
// the existing faction registry. The lib/bloodline-powers.js power
// table enumerates the recognised bloodlines + their preferred
// elements (sanguire→fire/lightning, medici→heal/bio, etc.).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_ancestry (
      npc_id            TEXT    PRIMARY KEY,
      primary_bloodline TEXT    NOT NULL,
      dilution          REAL    NOT NULL DEFAULT 1.0
                                CHECK (dilution BETWEEN 0.0 AND 1.0),
      established_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_npc_ancestry_bloodline ON npc_ancestry(primary_bloodline)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_ancestry (
      user_id           TEXT    PRIMARY KEY,
      primary_bloodline TEXT    NOT NULL,
      dilution          REAL    NOT NULL DEFAULT 0.5
                                CHECK (dilution BETWEEN 0.0 AND 1.0),
      chosen_at         INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_ancestry_bloodline ON user_ancestry(primary_bloodline)`);
}

export function down(_db) {
  // Forward-only — ancestry is permanent.
}
