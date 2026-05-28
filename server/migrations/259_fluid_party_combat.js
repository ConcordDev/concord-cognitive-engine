// server/migrations/259_fluid_party_combat.js
//
// Phase CC1 REWORK — fluid party combat (replaces the turn-based
// substrate from migration 251). All combat in Concordia is fluid
// real-time; party combat layers a real-time-with-pause command queue
// on top (FF7 Remake / BG3 RTwP shape), NOT a turn-based system.
//
// Migration 251's tables remain in place historically — they're now
// orphaned but harmless. New code reads/writes the tables below.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS party_combat_sessions (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'tactical'
                        CHECK (mode IN ('tactical','crpg','solo')),
      started_at_ms   INTEGER NOT NULL,
      ended_at_ms     INTEGER,
      winner_team     TEXT,
      profile_name    TEXT NOT NULL DEFAULT 'sifu_brawler',
      time_scale      REAL NOT NULL DEFAULT 1.0 CHECK (time_scale >= 0 AND time_scale <= 2.0)
    );
    CREATE INDEX IF NOT EXISTS idx_party_combat_active
      ON party_combat_sessions(world_id) WHERE ended_at_ms IS NULL;

    -- Each combatant has a wall-clock cooldown for their next ability
    -- (in ms, set when an ability fires). Real-time tick decrements
    -- through normal heartbeat or per-request resolution.
    CREATE TABLE IF NOT EXISTS party_combatants (
      session_id            TEXT NOT NULL,
      entity_kind           TEXT NOT NULL CHECK (entity_kind IN ('player','npc')),
      entity_id             TEXT NOT NULL,
      team                  TEXT NOT NULL,
      hp                    REAL NOT NULL,
      max_hp                REAL NOT NULL,
      next_action_at_ms     INTEGER NOT NULL,
      position_x            REAL NOT NULL DEFAULT 0,
      position_z            REAL NOT NULL DEFAULT 0,
      profile_name          TEXT,
      joined_at_ms          INTEGER NOT NULL,
      PRIMARY KEY (session_id, entity_id)
    );

    -- Queued abilities — the RTwP "pause and queue" pattern. Each
    -- combatant can hold one pending ability; it fires the next time
    -- the engine resolves and the combatant is off cooldown.
    CREATE TABLE IF NOT EXISTS party_queued_actions (
      session_id      TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      action_kind     TEXT NOT NULL CHECK (action_kind IN ('attack','move','ability','wait')),
      payload_json    TEXT NOT NULL DEFAULT '{}',
      queued_at_ms    INTEGER NOT NULL,
      PRIMARY KEY (session_id, entity_id)
    );

    CREATE TABLE IF NOT EXISTS party_action_log (
      id                 TEXT PRIMARY KEY,
      session_id         TEXT NOT NULL,
      actor_id           TEXT NOT NULL,
      action_kind        TEXT NOT NULL,
      target_id          TEXT,
      damage             REAL,
      resolved_at_ms     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_party_action_log_session
      ON party_action_log(session_id, resolved_at_ms);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_party_action_log_session;
    DROP TABLE IF EXISTS party_action_log;
    DROP TABLE IF EXISTS party_queued_actions;
    DROP TABLE IF EXISTS party_combatants;
    DROP INDEX IF EXISTS idx_party_combat_active;
    DROP TABLE IF EXISTS party_combat_sessions;
  `);
}
