// server/migrations/326_affect_trace_temperament.js
//
// Wave 7 / A6 + A3b storage. Two additions:
//   1. creature_affect_trace — per-world somatic memory for CREATURES (they have no
//      DTUs of their own): a salience-crossing felt-per reading at a place/time, batch
//      -flushed by the affect-trace cycle. "The deer remembers the meadow as fear."
//   2. world_npcs.temperament_json — the A3b individual-temperament home for creatures
//      + NPCs (the mutable 7-drive vector that inheritance/plasticity write to).
// Forward-only; column-existence guarded.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creature_affect_trace (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      creature_id   TEXT NOT NULL,
      species_id    TEXT,
      v             REAL NOT NULL DEFAULT 0,   -- valence -1..1
      a             REAL NOT NULL DEFAULT 0,   -- arousal 0..1
      dominant_drive TEXT,
      drive_value   REAL,
      intensity     REAL NOT NULL DEFAULT 0,   -- felt-per intensity (peak-end selected)
      reason        TEXT,                      -- the appraisal kind (predator/eat/...)
      fap           TEXT,                      -- released fixed-action-pattern, if any
      x             REAL,
      z             REAL,
      dtu_id        TEXT,                      -- the affect_memory DTU minted for top-K
      occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_creature_affect_trace_world ON creature_affect_trace(world_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_creature_affect_trace_creature ON creature_affect_trace(creature_id);
  `);

  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_npcs'").get()
      && !columnExists(db, "world_npcs", "temperament_json")) {
    try { db.exec("ALTER TABLE world_npcs ADD COLUMN temperament_json TEXT"); } catch { /* noop */ }
  }
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS creature_affect_trace;`);
}
