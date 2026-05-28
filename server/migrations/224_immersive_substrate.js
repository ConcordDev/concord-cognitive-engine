// server/migrations/224_immersive_substrate.js
//
// Phase X — immersive depth substrate. Several small tables that
// power the "small things that matter" features the user enumerated.

export function up(db) {
  // X2 — drunk state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_intoxication (
      user_id          TEXT PRIMARY KEY,
      blood_alcohol    REAL NOT NULL DEFAULT 0 CHECK (blood_alcohol >= 0 AND blood_alcohol <= 1),
      last_drink_at    INTEGER,
      last_decay_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // X4 — tracking skill XP (footprint reveal).
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_skill_xp (
      user_id     TEXT PRIMARY KEY,
      xp          INTEGER NOT NULL DEFAULT 0,
      level       INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // X5 — riding double (two players on one mount).
  db.exec(`
    CREATE TABLE IF NOT EXISTS mount_riders (
      mount_id            TEXT PRIMARY KEY,
      primary_user_id     TEXT NOT NULL,
      secondary_user_id   TEXT,
      mounted_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      passenger_joined_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mount_riders_primary
      ON mount_riders(primary_user_id);
    CREATE INDEX IF NOT EXISTS idx_mount_riders_secondary
      ON mount_riders(secondary_user_id);
  `);

  // X3 — letter delivery queue (paper variant of mail, delivered with
  // a deliberate delay by NPC couriers).
  db.exec(`
    CREATE TABLE IF NOT EXISTS letter_delivery_queue (
      id              TEXT PRIMARY KEY,
      from_user_id    TEXT NOT NULL,
      to_user_id      TEXT NOT NULL,
      body            TEXT NOT NULL,
      sealed_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      deliver_at      INTEGER NOT NULL,
      delivered_at    INTEGER,
      courier_npc_id  TEXT,
      world_id        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_letter_pending
      ON letter_delivery_queue(deliver_at) WHERE delivered_at IS NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_letter_pending;
    DROP TABLE IF EXISTS letter_delivery_queue;
    DROP INDEX IF EXISTS idx_mount_riders_secondary;
    DROP INDEX IF EXISTS idx_mount_riders_primary;
    DROP TABLE IF EXISTS mount_riders;
    DROP TABLE IF EXISTS tracking_skill_xp;
    DROP TABLE IF EXISTS player_intoxication;
  `);
}
