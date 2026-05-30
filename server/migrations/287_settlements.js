// server/migrations/287_settlements.js
//
// Living Society — Phase 1.5: settlement composition + role vacancy.
//
// Population was not taxonomy-aware (random archetypes per region) and roles
// were not load-bearing (kill the blacksmith → nothing happens). These tables
// make a settlement a first-class cluster with a required-role composition, and
// make every critical role load-bearing: a killed role opens a VACANCY that a
// recruit-cycle fills or, unfilled, accrues resentment + a grievance vs the
// killer (feeding Phase 4/5). Per-world write tables.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "settlements")) {
    db.exec(`
      CREATE TABLE settlements (
        id         TEXT PRIMARY KEY,
        world_id   TEXT NOT NULL,
        name       TEXT NOT NULL,
        center_x   REAL NOT NULL DEFAULT 0,
        center_z   REAL NOT NULL DEFAULT 0,
        radius_m   REAL NOT NULL DEFAULT 200,
        faction_id TEXT,
        realm_id   TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_settlements_world ON settlements(world_id);
    `);
  }
  if (!tableExists(db, "settlement_vacancies")) {
    db.exec(`
      CREATE TABLE settlement_vacancies (
        id           TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL,
        world_id     TEXT NOT NULL,
        role         TEXT NOT NULL,
        building_id  TEXT,
        opened_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        filled_at    INTEGER,
        filled_by    TEXT,
        killer_id    TEXT,            -- who created the vacancy (if a kill)
        killer_kind  TEXT,            -- 'player' | 'npc'
        resentment   INTEGER NOT NULL DEFAULT 0,
        UNIQUE (settlement_id, role, opened_at)
      );
      CREATE INDEX idx_vacancy_open ON settlement_vacancies(world_id, filled_at);
    `);
  }
  // NPC ↔ settlement membership (which settlement an NPC belongs to + its role).
  try {
    if (!db.pragma(`table_info(world_npcs)`).some((c) => c.name === "settlement_id")) {
      db.exec(`ALTER TABLE world_npcs ADD COLUMN settlement_id TEXT`);
    }
  } catch { /* world_npcs absent on minimal build */ }
  try {
    if (!db.pragma(`table_info(world_npcs)`).some((c) => c.name === "settlement_role")) {
      db.exec(`ALTER TABLE world_npcs ADD COLUMN settlement_role TEXT`);
    }
  } catch { /* noop */ }
}

export function down(_db) {
  // forward-only
}
