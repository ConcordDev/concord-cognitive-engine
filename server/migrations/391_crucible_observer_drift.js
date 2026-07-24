// server/migrations/391_crucible_observer_drift.js
//
// lattice-crucible bespoke mechanic — "player-conditional drift".
//
// Grounded directly in authored lore (content/world/lattice-crucible/):
//
//   npcs.json, witness_orla.narrative_context.secret:
//     "Orla has identified a class of drift alerts that the lattice
//      produces only when a player is standing in the Crucible. She has
//      not told the other Witnesses because she does not know whether
//      to call this evidence of intent."
//
//   lore.json, crucible_lore_orla_observation:
//     "hidden_truth": "The class of alerts Orla has identified is real.
//      The lattice IS producing player-conditional drift. The cause is
//      unclear; the federation has not been notified."
//
// Every other world's lattice-born content (server/emergent/
// lattice-quest-cycle.js, server/lib/procgen-regions.js) fires from the
// global drift-monitor on a fixed heartbeat cadence, independent of
// whether any player is present. The Crucible's lore explicitly claims
// its drift is *different* — some of it only happens because a player
// is there to observe it. This table is the real, testable substrate
// for that claim: a log entry is only ever written while a player has
// an active (undeparted) world_visits row in lattice-crucible, and the
// world_id CHECK enforces the mechanic can never leak to another world
// even under a coding mistake upstream.
//
// `disclosed` mirrors "she has not told the other Witnesses" — the
// corpus accumulates privately; a future Charter Question resolution
// (crucible_lore_charter_question) is the only thing that flips it.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS crucible_observer_drift_log (
      id                TEXT PRIMARY KEY,
      world_id          TEXT NOT NULL CHECK (world_id = 'lattice-crucible'),
      observer_user_id  TEXT NOT NULL,
      drift_type        TEXT NOT NULL,
      severity          TEXT NOT NULL DEFAULT 'info'
                          CHECK (severity IN ('info', 'warning', 'alert')),
      corpus_note       TEXT,
      disclosed         INTEGER NOT NULL DEFAULT 0 CHECK (disclosed IN (0, 1)),
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_crucible_observer_drift_world_time
      ON crucible_observer_drift_log(world_id, created_at)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_crucible_observer_drift_user
      ON crucible_observer_drift_log(observer_user_id)
  `).run();
}
