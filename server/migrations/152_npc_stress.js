// Migration 152 — Sprint C / Track A1: NPC Stress + Mental Break + Coping Trait.
//
// Adds an internal-pressure dimension to every NPC. Stress accrues from
// new grudges, preoccupation switches, faction war, heir deaths, and ritual
// failures. At 80+ an NPC mental-breaks and locks a coping trait for
// 7 in-game days. Coping trait flows into:
//   - narrative-bridge.js#buildNPCTraits (one extra trait line)
//   - faction-strategy.js#pickMove (paranoid leaders bias toward RAID/WAR;
//     reckless leaders bias toward EXPAND)
//   - npc-routines.js (drinker spends 2 extra blocks at tavern)
// Decay 1/day toward 30 baseline.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_stress (
      npc_id        TEXT    PRIMARY KEY,
      stress        INTEGER NOT NULL DEFAULT 30
                            CHECK (stress BETWEEN 0 AND 100),
      coping_trait  TEXT
                            CHECK (coping_trait IS NULL OR coping_trait IN
                              ('drink', 'reckless', 'paranoid', 'withdraw', 'cruel')),
      last_break_at INTEGER,
      coping_until  INTEGER,
      last_decay_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_stress_high     ON npc_stress(stress);
    CREATE INDEX IF NOT EXISTS idx_stress_coping   ON npc_stress(coping_trait, coping_until);
  `);
}

export function down(_db) {
  // Forward-only — stress history is the substrate.
}
