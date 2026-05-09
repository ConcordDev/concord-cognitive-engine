// Migration 130 — Phase 4a: NPC Daily Lives.
//
// Each NPC gets a deterministic 24h schedule split into 8 three-hour
// blocks. The npc-routine-cycle heartbeat advances them in real time,
// updating world_npcs.current_location JSON + writing embodied signals
// per activity (Layer 7 reuse).
//
// Tables:
//   npc_schedules       — per NPC × per block (id, npc_id, block_idx,
//                         activity_kind, location_kind, target_x, target_z,
//                         day_seed, preoccupation_signature, generated_at)
//   npc_routine_state   — currently executing activity per NPC

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_schedules (
      id                       TEXT    PRIMARY KEY,
      npc_id                   TEXT    NOT NULL,
      block_idx                INTEGER NOT NULL CHECK (block_idx BETWEEN 0 AND 7),
      activity_kind            TEXT    NOT NULL CHECK (activity_kind IN (
                                          'sleep', 'train', 'craft', 'gather',
                                          'trade', 'commune', 'socialize',
                                          'patrol', 'wander', 'rest')),
      location_kind            TEXT    NOT NULL CHECK (location_kind IN (
                                          'home', 'workplace', 'market', 'grove',
                                          'temple', 'tavern', 'wilds', 'plaza')),
      target_x                 REAL    NOT NULL DEFAULT 0,
      target_z                 REAL    NOT NULL DEFAULT 0,
      day_seed                 INTEGER NOT NULL,
      preoccupation_signature  TEXT,
      generated_at             INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (npc_id, block_idx, day_seed)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_sched_npc_day
      ON npc_schedules(npc_id, day_seed);
    CREATE INDEX IF NOT EXISTS idx_npc_sched_block
      ON npc_schedules(npc_id, block_idx);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_routine_state (
      npc_id           TEXT    PRIMARY KEY,
      current_block    INTEGER NOT NULL CHECK (current_block BETWEEN 0 AND 7),
      activity_kind    TEXT    NOT NULL,
      location_kind    TEXT    NOT NULL,
      target_x         REAL    NOT NULL DEFAULT 0,
      target_z         REAL    NOT NULL DEFAULT 0,
      started_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      arrived_at       INTEGER,
      expected_end_at  INTEGER NOT NULL,
      last_signal_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_npc_routine_block
      ON npc_routine_state(current_block, expected_end_at);
  `);
}

export function down(_db) { /* forward-only */ }
