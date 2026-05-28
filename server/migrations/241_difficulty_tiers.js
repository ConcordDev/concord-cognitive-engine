// server/migrations/241_difficulty_tiers.js
//
// Phase BD2 — 4-tier difficulty ladder (finder/normal/heroic/mythic).
//
// Tournaments + boss events have `kind`, not difficulty. This adds a
// difficulty_tier column to the relevant encounter tables (best-effort
// ALTERs — tolerates missing tables on minimal builds) + a
// difficulty_modifiers seed table so the runtime can apply scaling.

const DIFFICULTY_SEED = [
  ["finder", 0.5, 0.5, 0.5, 24],
  ["normal", 1.0, 1.0, 1.0, 72],
  ["heroic", 1.5, 1.5, 1.5, 168],
  ["mythic", 2.5, 2.5, 2.5, 168],
];

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS difficulty_modifiers (
      tier          TEXT PRIMARY KEY,
      damage_mult   REAL NOT NULL,
      health_mult   REAL NOT NULL,
      loot_mult     REAL NOT NULL,
      lockout_h     INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO difficulty_modifiers (tier, damage_mult, health_mult, loot_mult, lockout_h)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tier) DO UPDATE SET
      damage_mult = excluded.damage_mult,
      health_mult = excluded.health_mult,
      loot_mult = excluded.loot_mult,
      lockout_h = excluded.lockout_h
  `);
  for (const row of DIFFICULTY_SEED) insert.run(...row);

  // tournaments + world_events + world_boss_active difficulty_tier column.
  for (const table of ["tournaments", "world_events", "world_boss_active"]) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes("difficulty_tier")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN difficulty_tier TEXT DEFAULT 'normal'`);
      }
    } catch { /* table not present in minimal build — tolerated */ }
  }

  // Track per-user prerequisite chain (mythic requires heroic clear of
  // SAME encounter, etc.).
  db.exec(`
    CREATE TABLE IF NOT EXISTS difficulty_clears (
      user_id        TEXT NOT NULL,
      encounter_id   TEXT NOT NULL,
      tier           TEXT NOT NULL,
      cleared_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, encounter_id, tier)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS difficulty_clears;
    DROP TABLE IF EXISTS difficulty_modifiers;
  `);
}
