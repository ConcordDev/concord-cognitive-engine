// server/migrations/096_player_world_metrics.js
//
// EvoEcosystem + Three Pillars: per-player, per-world metrics that drive
// reactive NPC behavior. Four scalars:
//   ecosystem_score       — sustainable harvest +; overhunt / clearcut −.
//                           Concordia (goddess) reads this to decide warm/cold.
//   concord_alignment     — min-max optimization +; predictable / by-the-rules
//                           voting +. Concord visits when this dominates.
//   concordia_alignment   — wild creation +; unique recipes published +;
//                           gifts to NPCs +. Concordia warmer when balanced.
//   refusal_debt          — accumulates when player breaks consequence rules
//                           (PvP without consent, stealing from authored NPCs).
//                           Decays slowly. Sovereign visits when high.
//
// All values float, default 0. updated_at supports decay sweeps.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_world_metrics (
      user_id              TEXT NOT NULL,
      world_id             TEXT NOT NULL,
      ecosystem_score      REAL NOT NULL DEFAULT 0,
      concord_alignment    REAL NOT NULL DEFAULT 0,
      concordia_alignment  REAL NOT NULL DEFAULT 0,
      refusal_debt         REAL NOT NULL DEFAULT 0,
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id)
    );

    CREATE INDEX IF NOT EXISTS idx_player_world_metrics_world
      ON player_world_metrics(world_id);
    CREATE INDEX IF NOT EXISTS idx_player_world_metrics_updated
      ON player_world_metrics(updated_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
