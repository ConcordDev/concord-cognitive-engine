// server/migrations/289_vassalage.js
//
// Living Society — Phase 11: governance hierarchy. The vassalage edge — the one
// new primitive that makes political nesting LOAD-BEARING: tribute flows UP,
// protection flows DOWN, and a liege that takes tribute but fails to defend a
// raided vassal accrues a grievance (Phase 4) that can seed secession (Phase 5).
//
// + emperor recognition state (per-world, earned by conquest, shatters-on-death
// into an EMPTY throne — no inheritance).

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "vassalage")) {
    db.exec(`
      CREATE TABLE vassalage (
        id            TEXT PRIMARY KEY,
        world_id      TEXT NOT NULL,
        liege_kind    TEXT NOT NULL,    -- realm | empire | settlement
        liege_id      TEXT NOT NULL,
        vassal_kind   TEXT NOT NULL,    -- realm | settlement | land_claim
        vassal_id     TEXT NOT NULL,
        tier          INTEGER NOT NULL DEFAULT 1,
        tribute_rate  INTEGER NOT NULL DEFAULT 50,
        tribute_cadence_s INTEGER NOT NULL DEFAULT 86400,
        protection_owed INTEGER NOT NULL DEFAULT 1,
        skim_pct      REAL NOT NULL DEFAULT 0,
        collector_id  TEXT,
        last_tribute_at INTEGER,
        last_defense_at INTEGER,
        raid_pending_since INTEGER,
        secession_eligible INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'sworn'
                        CHECK (status IN ('sworn','seceding','seceded','broken')),
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (vassal_kind, vassal_id)   -- a polity has ONE liege
      );
      CREATE INDEX idx_vassalage_liege ON vassalage(liege_kind, liege_id);
      CREATE INDEX idx_vassalage_world ON vassalage(world_id, status);
    `);
  }
  if (!tableExists(db, "world_emperors")) {
    db.exec(`
      CREATE TABLE world_emperors (
        world_id    TEXT PRIMARY KEY,
        emperor_kind TEXT NOT NULL,
        emperor_id  TEXT NOT NULL,
        crowned_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        lore_dtu_id TEXT,
        fell_at     INTEGER,
        fell_reason TEXT
      );
    `);
  }
  // Realm tier for the polity tree (empire = realm with no liege controlling all).
  if (tableExists(db, "realms") && !columnExists(db, "realms", "liege_realm_id")) {
    try { db.exec(`ALTER TABLE realms ADD COLUMN liege_realm_id TEXT`); } catch { /* noop */ }
  }
}

export function down(_db) {
  // forward-only
}
