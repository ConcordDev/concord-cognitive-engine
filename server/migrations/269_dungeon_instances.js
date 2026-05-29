// server/migrations/269_dungeon_instances.js
//
// C3 / F5.1 — instanced dungeon/raid. Ties the existing pieces (boss phases,
// parties, difficulty tiers, boss-HUD, lockouts) into a unified party-scoped
// PvE encounter: open → fight a phased boss → per-member damage → loot gate by
// participation → clear/wipe + lockout. The missing WoW/FFXIV "run".

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dungeon_instances (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      leader_user   TEXT NOT NULL,
      party_id      TEXT,
      encounter_id  TEXT NOT NULL,
      tier          TEXT NOT NULL DEFAULT 'finder',
      boss_npc_id   TEXT,
      boss_name     TEXT,
      boss_hp       REAL NOT NULL,
      boss_max_hp   REAL NOT NULL,
      phase_idx     INTEGER NOT NULL DEFAULT 0,
      phase_name    TEXT,
      status        TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','cleared','wiped','abandoned')),
      started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at      INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dungeon_participants (
      instance_id   TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'dps',
      damage_dealt  REAL NOT NULL DEFAULT 0,
      downed        INTEGER NOT NULL DEFAULT 0,
      loot_json     TEXT,
      PRIMARY KEY (instance_id, user_id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dungeon_lockouts (
      user_id       TEXT NOT NULL,
      encounter_id  TEXT NOT NULL,
      tier          TEXT NOT NULL,
      locked_until  INTEGER NOT NULL,
      PRIMARY KEY (user_id, encounter_id, tier)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dungeon_active ON dungeon_instances(status, world_id);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS dungeon_lockouts;`);
  db.exec(`DROP TABLE IF EXISTS dungeon_participants;`);
  db.exec(`DROP TABLE IF EXISTS dungeon_instances;`);
}
