// server/migrations/178_underwater_features.js
//
// Concordia Phase 8 — underwater depth content (kelp / coral / wreck /
// trench / cave).
//
// Authored or procgen-spawned environmental features positioned by
// (world_id, x, z, depth_min_m, depth_max_m). Each feature has a
// kind, a radius the player must be inside to see it surface in the
// HUD, and an aggression flag that hints sea-creature spawning.
//
// Spawn ledger uses water-fauna spawn entries from the existing fauna
// system (we just tag aquatic species with `aquatic=1` and let
// creature-flock-cycle handle the actual movement).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS underwater_features (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      kind          TEXT    NOT NULL CHECK (kind IN
                            ('kelp_forest','coral_garden','wreck_site','trench_cave','underwater_ruin')),
      name          TEXT    NOT NULL,
      pos_x         REAL    NOT NULL,
      pos_z         REAL    NOT NULL,
      depth_min_m   REAL    NOT NULL DEFAULT 0,
      depth_max_m   REAL    NOT NULL DEFAULT 30,
      radius_m      REAL    NOT NULL DEFAULT 50 CHECK (radius_m BETWEEN 5 AND 500),
      aggression    INTEGER NOT NULL DEFAULT 0 CHECK (aggression IN (0,1,2,3)),
      lore_json     TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uw_world ON underwater_features(world_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uw_kind ON underwater_features(world_id, kind)`);

  // Aquatic species registry — kraken / leviathan / eel etc.
  db.exec(`
    CREATE TABLE IF NOT EXISTS aquatic_species (
      species_id      TEXT    PRIMARY KEY,
      display_name    TEXT    NOT NULL,
      taxonomy_prefix TEXT    NOT NULL DEFAULT 's',
      threat_tier     INTEGER NOT NULL DEFAULT 1 CHECK (threat_tier BETWEEN 0 AND 5),
      preferred_depth_m REAL  NOT NULL DEFAULT 20,
      pursuit_radius_m REAL   NOT NULL DEFAULT 30,
      pain_per_bite   REAL    NOT NULL DEFAULT 0.2,
      attack_cooldown_s INTEGER NOT NULL DEFAULT 30
    )
  `);

  // Seed minimum viable aquatic species so threat AI has something to
  // work with on a fresh build.
  db.prepare(`INSERT INTO aquatic_species (species_id, display_name, threat_tier, preferred_depth_m, pursuit_radius_m, pain_per_bite) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('s-kraken', 'Kraken', 5, 60, 40, 0.6);
  db.prepare(`INSERT INTO aquatic_species (species_id, display_name, threat_tier, preferred_depth_m, pursuit_radius_m, pain_per_bite) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('s-leviathan', 'Leviathan', 4, 80, 50, 0.5);
  db.prepare(`INSERT INTO aquatic_species (species_id, display_name, threat_tier, preferred_depth_m, pursuit_radius_m, pain_per_bite) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('s-eel', 'Eel', 2, 20, 15, 0.15);
  db.prepare(`INSERT INTO aquatic_species (species_id, display_name, threat_tier, preferred_depth_m, pursuit_radius_m, pain_per_bite) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('s-anglerfish', 'Anglerfish', 3, 100, 25, 0.35);
}

export function down(_db) {
  // Forward-only.
}
