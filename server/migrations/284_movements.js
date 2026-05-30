// server/migrations/284_movements.js
//
// Living Society — Phase 5: the Movement/Cell primitive (THE KEYSTONE).
//
// The one genuinely-new structure: a grievance-seeded coalition that recruits
// ACROSS POWER TIERS (civilian ↔ authored ↔ player) and ACROSS WORLDS under a
// secrecy-vs-discovery tension. Recruit fast → exposed → suppressed; slow → the
// ruler consolidates. At a member threshold the movement flips to `acting` and
// erupts (Phase 6). This is the connective layer the audit found MISSING — the
// politics blocks (grudges, schemes, overhear, faction stances) all existed but
// nothing bound a cross-tier membership graph.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "movements")) {
    db.exec(`
      CREATE TABLE movements (
        id              TEXT PRIMARY KEY,
        world_id        TEXT NOT NULL,
        founded_by_kind TEXT NOT NULL DEFAULT 'npc' CHECK (founded_by_kind IN ('npc','player')),
        founded_by_id   TEXT NOT NULL,
        target_kind     TEXT NOT NULL CHECK (target_kind IN ('faction','npc','player','realm')),
        target_id       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'recruiting'
                          CHECK (status IN ('recruiting','organized','acting','completed','suppressed')),
        visibility_level INTEGER NOT NULL DEFAULT 0 CHECK (visibility_level BETWEEN 0 AND 100),
        action_threshold INTEGER NOT NULL DEFAULT 3,
        grievance_severity INTEGER NOT NULL DEFAULT 0,
        narrative_json  TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_movements_world ON movements(world_id, status);
      CREATE INDEX idx_movements_target ON movements(target_kind, target_id);
      -- one active movement per (founder, target) so seeding is idempotent
      CREATE UNIQUE INDEX idx_movements_seed ON movements(world_id, founded_by_id, target_kind, target_id);
    `);
  }
  if (!tableExists(db, "movement_members")) {
    db.exec(`
      CREATE TABLE movement_members (
        movement_id    TEXT NOT NULL,
        member_kind    TEXT NOT NULL CHECK (member_kind IN ('npc','player')),
        member_id      TEXT NOT NULL,
        member_world_id TEXT,            -- cross-world membership (N=2 cross-world)
        role           TEXT NOT NULL DEFAULT 'soldier'
                          CHECK (role IN ('founder','recruiter','soldier','informant','supplier')),
        secrecy_level  INTEGER NOT NULL DEFAULT 50,
        loyalty        REAL NOT NULL DEFAULT 0.6,
        joined_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        left_at        INTEGER,
        PRIMARY KEY (movement_id, member_kind, member_id)
      );
      CREATE INDEX idx_movement_members_mid ON movement_members(movement_id, left_at);
      CREATE INDEX idx_movement_members_who ON movement_members(member_kind, member_id);
    `);
  }
  if (!tableExists(db, "movement_plans")) {
    db.exec(`
      CREATE TABLE movement_plans (
        id            TEXT PRIMARY KEY,
        movement_id   TEXT NOT NULL,
        phase         INTEGER NOT NULL DEFAULT 0,
        description   TEXT,
        required_members INTEGER NOT NULL DEFAULT 2,
        completion_predicate_json TEXT,
        completed_at  INTEGER,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_movement_plans_mid ON movement_plans(movement_id, phase);
    `);
  }
  if (!tableExists(db, "movement_visibility")) {
    db.exec(`
      CREATE TABLE movement_visibility (
        movement_id        TEXT NOT NULL,
        discovered_by_kind TEXT NOT NULL,
        discovered_by_id   TEXT NOT NULL,
        method             TEXT,
        discovered_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (movement_id, discovered_by_kind, discovered_by_id)
      );
    `);
  }
}

export function down(_db) {
  // forward-only
}
