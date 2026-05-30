// server/migrations/283_employment_edges.js
//
// Living Society — Phase 3: sparks-flow. The pay graph.
//
// `employment_edges` is the spine of the economic-flow model: pay moves along
// an edge from an employer (a realm treasury / an NPC / the world) to a worker
// (a player / an NPC) on a payday cadence. A collector can DIVERT a fraction
// (skim_pct = petty corruption). A worker owed-but-unpaid accrues a grievance
// against the employer (Phase 4). Per-world write table.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "employment_edges")) {
    db.exec(`
      CREATE TABLE employment_edges (
        id            TEXT PRIMARY KEY,
        world_id      TEXT NOT NULL,
        employer_kind TEXT NOT NULL CHECK (employer_kind IN ('realm','npc','world','faction')),
        employer_id   TEXT NOT NULL,
        worker_kind   TEXT NOT NULL CHECK (worker_kind IN ('player','npc')),
        worker_id     TEXT NOT NULL,
        role          TEXT,
        pay_form      TEXT NOT NULL DEFAULT 'day_wage'
                        CHECK (pay_form IN ('day_wage','piece','in_kind','tribute','stipend')),
        rate_sparks   INTEGER NOT NULL DEFAULT 10,
        payday_freq_s INTEGER NOT NULL DEFAULT 86400,
        skim_pct      REAL NOT NULL DEFAULT 0 CHECK (skim_pct BETWEEN 0 AND 0.9),
        collector_kind TEXT CHECK (collector_kind IN ('npc','player','realm')),
        collector_id  TEXT,
        unpaid_streak INTEGER NOT NULL DEFAULT 0,
        last_paid_at  INTEGER,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        active        INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_employment_world ON employment_edges(world_id, active);
      CREATE INDEX idx_employment_worker ON employment_edges(worker_kind, worker_id);
      CREATE INDEX idx_employment_employer ON employment_edges(employer_kind, employer_id);
    `);
  }
}

export function down(_db) {
  // forward-only
}
