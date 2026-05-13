// server/migrations/189_npc_equal_agency.js
//
// Phase T — NPC equal-agency cross-world substrate.
//
// Tables:
//   npc_residency       — immutable home_world + mutable current_world per NPC
//   npc_travel_intents  — queued cross-world travel orders
//   npc_skills          — per-NPC XP/level mirror of user_skills
//   npc_active_quests   — quests an NPC has accepted + is pursuing
//   npc_ambition_log    — audit trail for high-ambition NPC actions
//
// Plus columns on existing tables:
//   world_npcs.home_world_id      — backfilled from current world_id
//   world_npcs.ambition_score     — 0..1 driver of unilateral high-stakes moves

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_residency (
      npc_id              TEXT PRIMARY KEY,
      home_world_id       TEXT NOT NULL,
      current_world_id    TEXT NOT NULL,
      arrived_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      total_worlds_visited INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_npc_residency_current ON npc_residency(current_world_id);
    CREATE INDEX IF NOT EXISTS idx_npc_residency_home    ON npc_residency(home_world_id);

    CREATE TABLE IF NOT EXISTS npc_travel_intents (
      id                  TEXT PRIMARY KEY,
      npc_id              TEXT NOT NULL,
      destination_world_id TEXT NOT NULL,
      reason              TEXT NOT NULL CHECK (reason IN ('skill_grind','quest_pursuit','assassination_target','marketplace_arbitrage','kingdom_target','flee','homecoming','curiosity')),
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      executes_at         INTEGER NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS idx_npc_travel_pending ON npc_travel_intents(status, executes_at);
    CREATE INDEX IF NOT EXISTS idx_npc_travel_npc     ON npc_travel_intents(npc_id);

    CREATE TABLE IF NOT EXISTS npc_skills (
      npc_id              TEXT NOT NULL,
      skill_id            TEXT NOT NULL,
      xp                  REAL NOT NULL DEFAULT 0,
      level               INTEGER NOT NULL DEFAULT 1,
      last_used_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, skill_id)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_skills_skill ON npc_skills(skill_id, level);

    CREATE TABLE IF NOT EXISTS npc_active_quests (
      id                  TEXT PRIMARY KEY,
      npc_id              TEXT NOT NULL,
      quest_id            TEXT NOT NULL,
      accepted_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      current_step        INTEGER NOT NULL DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned','failed')),
      origin_world_id     TEXT,
      payload_json        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_npc_active_quests_npc    ON npc_active_quests(npc_id, status);
    CREATE INDEX IF NOT EXISTS idx_npc_active_quests_quest  ON npc_active_quests(quest_id);

    CREATE TABLE IF NOT EXISTS npc_ambition_log (
      id                  TEXT PRIMARY KEY,
      npc_id              TEXT NOT NULL,
      move_kind           TEXT NOT NULL,
      target_kind         TEXT,
      target_id           TEXT,
      world_id            TEXT,
      outcome             TEXT,
      logged_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_npc_ambition_log_npc ON npc_ambition_log(npc_id, logged_at);
  `);

  // Add columns to world_npcs (idempotent — guard ALTER with try/catch).
  for (const sql of [
    `ALTER TABLE world_npcs ADD COLUMN home_world_id TEXT`,
    `ALTER TABLE world_npcs ADD COLUMN ambition_score REAL NOT NULL DEFAULT 0.3`,
  ]) {
    try { db.exec(sql); } catch (e) {
      // Column likely exists from a partial earlier run — ignore.
      if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
    }
  }

  // Backfill home_world_id = world_id for existing rows that don't have one.
  db.exec(`
    UPDATE world_npcs
       SET home_world_id = world_id
     WHERE home_world_id IS NULL OR home_world_id = '';
  `);

  // Seed npc_residency from world_npcs for any NPC missing a residency row.
  db.exec(`
    INSERT OR IGNORE INTO npc_residency (npc_id, home_world_id, current_world_id, arrived_at)
    SELECT id,
           COALESCE(home_world_id, world_id),
           world_id,
           COALESCE(created_at, unixepoch())
      FROM world_npcs;
  `);
}

export function down(_db) { /* forward-only */ }
