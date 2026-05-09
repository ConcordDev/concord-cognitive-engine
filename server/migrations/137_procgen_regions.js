// Migration 137 — Phase 5e: Procgen Wilderness.
//
// Lattice drift findings (Phase 4c) already become quests planted on
// NPCs. Phase 5e takes a step further: certain drift kinds spawn
// ACTUAL TERRAIN — a haunted glade, a corrupt market, a hollow
// chamber — that the player can travel to.
//
// Each region is a circular zone in a world with:
//   - A drift signature it was born from
//   - A region_kind (haunted_glade / corrupt_market / hollow_chamber /
//     overgrown_wild / silent_field)
//   - Bias modifiers on the embodied signal layer (Layer 7) — a
//     haunted glade is colder + lower light + softer noise
//   - A modulator on gather/combat in its bounds
//   - A lifecycle: regions decay if their underlying drift resolves
//
// Tables:
//   procgen_regions      — one row per region
//   procgen_region_visits — per-user log (for quest realization)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS procgen_regions (
      id                       TEXT    PRIMARY KEY,
      world_id                 TEXT    NOT NULL,
      drift_alert_signature    TEXT    NOT NULL,
      drift_type               TEXT    NOT NULL,
      region_kind              TEXT    NOT NULL CHECK (region_kind IN (
                                          'haunted_glade', 'corrupt_market',
                                          'hollow_chamber', 'overgrown_wild',
                                          'silent_field')),
      anchor_x                 REAL    NOT NULL,
      anchor_z                 REAL    NOT NULL,
      radius_m                 REAL    NOT NULL DEFAULT 30,
      narrative                TEXT,
      composed_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      decayed_at               INTEGER,
      decay_reason             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pgr_world ON procgen_regions(world_id, composed_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pgr_drift_sig ON procgen_regions(drift_alert_signature);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS procgen_region_visits (
      id           TEXT    PRIMARY KEY,
      region_id    TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      visited_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pgrv_region ON procgen_region_visits(region_id, visited_at);
    CREATE INDEX IF NOT EXISTS idx_pgrv_user   ON procgen_region_visits(user_id, visited_at);
  `);
}

export function down(_db) { /* forward-only */ }
