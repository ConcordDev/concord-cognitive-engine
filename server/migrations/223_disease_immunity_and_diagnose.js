// server/migrations/223_disease_immunity_and_diagnose.js
//
// Phase W2 — immunity ledger + diagnose-skill XP tracking.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS disease_immunity (
      user_id              TEXT NOT NULL,
      disease_id           TEXT NOT NULL,
      acquired_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      mutation_resistant   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, disease_id)
    );

    CREATE TABLE IF NOT EXISTS diagnose_skill_xp (
      user_id    TEXT PRIMARY KEY,
      xp         INTEGER NOT NULL DEFAULT 0,
      level      INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS diagnose_skill_xp;
    DROP TABLE IF EXISTS disease_immunity;
  `);
}
