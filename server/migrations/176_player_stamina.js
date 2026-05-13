// server/migrations/176_player_stamina.js
//
// Concordia Phase 5 — player stamina (climbing, sprinting, holding
// breath, future BotW-style endurance gates).
//
// Per-(user, world) row. Stamina is 0..100 integer; regen is computed
// on each read by deriving from last_update (lazy clock — no
// heartbeat). Caller supplies the regen/drain rate per activity.
//
// Phase 5 wires climbing only. The shape allows additional stamina
// consumers (sprint in Phase 6, swim breath via player_oxygen mig 157,
// etc.) without further migrations.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_stamina (
      user_id      TEXT    NOT NULL,
      world_id     TEXT    NOT NULL DEFAULT 'concordia-hub',
      value        REAL    NOT NULL DEFAULT 100.0
                           CHECK (value BETWEEN 0.0 AND 100.0),
      max_value    REAL    NOT NULL DEFAULT 100.0
                           CHECK (max_value BETWEEN 10.0 AND 500.0),
      last_update  INTEGER NOT NULL DEFAULT (unixepoch()),
      state        TEXT    NOT NULL DEFAULT 'rest'
                           CHECK (state IN ('rest','climbing','sprinting','swimming','exhausted')),
      PRIMARY KEY (user_id, world_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stamina_state ON player_stamina(state)`);
}

export function down(_db) {
  // Forward-only.
}
