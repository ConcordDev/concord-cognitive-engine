// Migration 140 — Phase 8: Combat Polish Substrate.
//
// The shared layer ABOVE physics that makes combat feel like UFC,
// Sifu, Spider-Man, GTA, Cyberpunk — gas-tank stamina, awareness
// state machine, combo encoding, parry/dodge timing windows, stance
// + posture, rocked/staggered states, environmental grapples.
//
// One row per combat-active actor (player or NPC). A combat profile
// (genre-flavored parameter bundle) selects how forgiving the timing
// windows are, how fast gas recovers, how long rocked states linger,
// and whether perfect dodges trigger time dilation.
//
// Tables:
//   combat_actor_state — per (actor_kind, actor_id) live combat state
//   combat_events       — append-only log of polish events (combo, parry,
//                         rocked, finisher) for HUD + analytics

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_actor_state (
      actor_kind        TEXT    NOT NULL CHECK (actor_kind IN ('player', 'npc')),
      actor_id          TEXT    NOT NULL,
      world_id          TEXT    NOT NULL,
      profile_id        TEXT    NOT NULL DEFAULT 'street_freeroam',
      stance            TEXT    NOT NULL DEFAULT 'high'
                                CHECK (stance IN ('high', 'low', 'clinch', 'ground', 'aerial')),
      posture           TEXT    NOT NULL DEFAULT 'balanced'
                                CHECK (posture IN ('balanced', 'advancing', 'retreating', 'downed')),
      awareness         TEXT    NOT NULL DEFAULT 'idle'
                                CHECK (awareness IN ('idle', 'patrol', 'alert', 'combat', 'panic', 'routed')),
      awareness_target  TEXT,
      gas               REAL    NOT NULL DEFAULT 100 CHECK (gas >= 0),
      max_gas           REAL    NOT NULL DEFAULT 100,
      combo_count       INTEGER NOT NULL DEFAULT 0 CHECK (combo_count >= 0 AND combo_count <= 999),
      combo_last_at_ms  INTEGER NOT NULL DEFAULT 0,
      rocked_until_ms   INTEGER NOT NULL DEFAULT 0,
      grapple_target    TEXT,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (actor_kind, actor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cas_world      ON combat_actor_state(world_id, awareness);
    CREATE INDEX IF NOT EXISTS idx_cas_rocked     ON combat_actor_state(rocked_until_ms);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_events (
      id           TEXT    PRIMARY KEY,
      world_id     TEXT    NOT NULL,
      actor_kind   TEXT    NOT NULL,
      actor_id     TEXT    NOT NULL,
      event_kind   TEXT    NOT NULL CHECK (event_kind IN (
                            'combo_start', 'combo_extend', 'combo_break', 'combo_finish',
                            'parry', 'parry_perfect', 'dodge', 'dodge_perfect',
                            'rocked', 'finisher', 'gassed_out', 'grapple_start',
                            'grapple_environmental', 'awareness_transition',
                            'stance_change')),
      detail_json  TEXT,
      occurred_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_combat_evt_actor ON combat_events(actor_kind, actor_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_combat_evt_world ON combat_events(world_id, occurred_at);
  `);
}

export function down(_db) { /* forward-only */ }
