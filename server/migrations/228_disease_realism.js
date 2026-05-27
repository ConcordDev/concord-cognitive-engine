// server/migrations/228_disease_realism.js
//
// Phase AD — disease realism.
//
// Three new substrate layers gate disease transmission on player
// actions instead of uniform radius spread:
//
//   1. food_contamination — foodborne diseases attach to specific food
//      stacks; eating a contaminated food rolls the contraction probability.
//   2. water_source_contamination — waterborne diseases attach to a
//      water source (world+circle); drinking from inside rolls.
//   3. player_hygiene — hygiene level (0..1) modifies touch + airborne
//      contraction probability. Decays slowly via heartbeat; baths
//      restore it.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_contamination (
      food_dtu_id          TEXT NOT NULL,
      disease_id           TEXT NOT NULL,
      contamination_level  REAL NOT NULL CHECK (contamination_level >= 0 AND contamination_level <= 1),
      source_user_id       TEXT,
      contaminated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (food_dtu_id, disease_id)
    );
    CREATE INDEX IF NOT EXISTS idx_food_contam_disease ON food_contamination(disease_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS water_source_contamination (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      x             REAL NOT NULL,
      z             REAL NOT NULL,
      radius_m      REAL NOT NULL CHECK (radius_m > 0),
      disease_id    TEXT NOT NULL,
      level         REAL NOT NULL CHECK (level >= 0 AND level <= 1),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_water_contam_world ON water_source_contamination(world_id, expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_hygiene (
      user_id          TEXT PRIMARY KEY,
      hygiene_level    REAL NOT NULL DEFAULT 1.0 CHECK (hygiene_level >= 0 AND hygiene_level <= 1),
      last_bath_at     INTEGER,
      last_decay_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS player_hygiene;
    DROP INDEX IF EXISTS idx_water_contam_world;
    DROP TABLE IF EXISTS water_source_contamination;
    DROP INDEX IF EXISTS idx_food_contam_disease;
    DROP TABLE IF EXISTS food_contamination;
  `);
}
