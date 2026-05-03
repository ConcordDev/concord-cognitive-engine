// server/migrations/088_combat_flow.js
//
// Combat Flow substrate for the procedural emergent combat system.
//
// Two tables:
//   combat_flows  — every action a fighter takes in combat (hit, miss, parry,
//                   block, dodge, spell-cast, combo-step). Append-only stream.
//                   Each row is one action; chains are reconstructed by
//                   chain_id + step_index.
//   combat_combos — procedural combo recipes derived from a fighter's flow
//                   history. The flow engine reads recent flows for a
//                   (fighter, context, style) tuple and, after enough
//                   reinforcement, emits a combo row that becomes available
//                   to the hotbar.
//
// Both tables are owned by the system, not user-mintable. Each fighter
// (player or NPC) has their own personal evolution; combos are not shared
// across fighters automatically (though the marketplace path exists if a
// player wants to publish a combo as a citeable DTU later).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_flows (
      id            TEXT PRIMARY KEY,
      fighter_id    TEXT NOT NULL,
      fighter_kind  TEXT NOT NULL DEFAULT 'player',  -- 'player' | 'npc'
      context       TEXT NOT NULL,                   -- ground|aerial|vehicle|hacker|underwater|mixed
      style         TEXT,                            -- ufc|aerial-chain|breach|...
      action        TEXT NOT NULL,                   -- attack-light|attack-heavy|parry|block|dodge|spell|combo-step
      action_meta   TEXT NOT NULL DEFAULT '{}',      -- JSON: weapon, spell_id, combo_id, step_index, etc.
      target_id     TEXT,
      hit           INTEGER NOT NULL DEFAULT 0,      -- 1 if landed
      damage        REAL NOT NULL DEFAULT 0,
      is_crit       INTEGER NOT NULL DEFAULT 0,
      chain_id      TEXT,                            -- groups consecutive actions in one combo attempt
      step_index    INTEGER NOT NULL DEFAULT 0,      -- position within the chain
      ts            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_combat_flows_fighter ON combat_flows(fighter_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_combat_flows_context ON combat_flows(fighter_id, context, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_combat_flows_chain   ON combat_flows(chain_id, step_index);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_combos (
      id            TEXT PRIMARY KEY,
      fighter_id    TEXT NOT NULL,
      fighter_kind  TEXT NOT NULL DEFAULT 'player',
      context       TEXT NOT NULL,
      style         TEXT,
      name          TEXT NOT NULL,                   -- procedurally generated name
      steps_json    TEXT NOT NULL,                   -- [{ action, timing_ms, costs }]
      success_rate  REAL NOT NULL DEFAULT 0,
      uses          INTEGER NOT NULL DEFAULT 0,
      mastery_xp    REAL NOT NULL DEFAULT 0,         -- accumulates with each successful execution
      tier          INTEGER NOT NULL DEFAULT 1,      -- 1..5; tier-up at xp thresholds
      vfx_seed      TEXT NOT NULL DEFAULT '',        -- seeds procedural VFX
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at  INTEGER,
      UNIQUE(fighter_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_combat_combos_fighter ON combat_combos(fighter_id);
    CREATE INDEX IF NOT EXISTS idx_combat_combos_ctx     ON combat_combos(fighter_id, context, tier DESC);
  `);
}

export function down(_db) { /* sqlite — leave tables in place */ }
