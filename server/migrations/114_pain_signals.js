// server/migrations/109_pain_signals.js
//
// Layer 8: repair-pain coupling.
//
// pain_signals captures embodied damage events from the player's POV.
// Combat hits, environmental burns, falls, fatigue all push rows here.
// The repair-cycle heartbeat (server/emergent/repair-cycle.js) consumes
// pending rows in batches, awards endurance / strength / agility / vitality
// / focus XP based on which body region took the punishment, grants a
// short-lived `damage_resist` buff (the "what doesn't kill you makes you
// tougher" mechanic), and marks rows processed.
//
// Distinct from damage_events (which logs raw combat per side, attacker
// + defender) — pain_signals is a player-facing somatic ledger only,
// keyed by user_id, with a region taxonomy. NPCs don't generate pain
// signals; their adaptation is governed by archetype levels, not by a
// somatic budget.
//
// processed_at IS NULL → pending; the partial index keeps the pending
// query bounded even after years of play.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pain_signals (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      region        TEXT NOT NULL CHECK (region IN
                      ('head', 'torso', 'arms', 'legs', 'systemic')),
      intensity     REAL NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
      source        TEXT NOT NULL CHECK (source IN
                      ('combat', 'fall', 'environment', 'fatigue', 'spell', 'poison')),
      source_id     TEXT,
      element       TEXT,
      recorded_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      processed_at  INTEGER
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_pain_pending
      ON pain_signals(user_id, recorded_at)
      WHERE processed_at IS NULL
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_pain_user_recorded
      ON pain_signals(user_id, recorded_at DESC)
  `).run();
}

export function down(db) {
  db.prepare('DROP INDEX IF EXISTS idx_pain_user_recorded').run();
  db.prepare('DROP INDEX IF EXISTS idx_pain_pending').run();
  db.prepare('DROP TABLE IF EXISTS pain_signals').run();
}
