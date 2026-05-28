// server/migrations/247_farm_plots.js
//
// Phase CB3 — farm plots (Stardew-style cozy).
//
// land_claims (mig 135) gives a circular plot with ownership. This
// adds per-tile crop state within a claim: plant → grow over season
// days → harvest. seasons.js Phase 5c modulates yield per resource;
// per-crop affinity to season comes from content/crops.json.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claim_crops (
      claim_id              TEXT NOT NULL,
      tile_x                INTEGER NOT NULL,
      tile_y                INTEGER NOT NULL,
      crop_kind             TEXT NOT NULL,
      growth_stage          INTEGER NOT NULL DEFAULT 0
                              CHECK (growth_stage BETWEEN 0 AND 3),
      planted_season_idx    INTEGER NOT NULL,
      planted_day           INTEGER NOT NULL,
      watered_at            INTEGER,
      planted_by            TEXT NOT NULL,
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (claim_id, tile_x, tile_y)
    );
    CREATE INDEX IF NOT EXISTS idx_claim_crops_claim
      ON claim_crops(claim_id);
    CREATE INDEX IF NOT EXISTS idx_claim_crops_kind
      ON claim_crops(crop_kind, growth_stage);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_claim_crops_kind;
    DROP INDEX IF EXISTS idx_claim_crops_claim;
    DROP TABLE IF EXISTS claim_crops;
  `);
}
