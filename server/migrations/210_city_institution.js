// server/migrations/210_city_institution.js
//
// Phase II Wave 18 — city institution depth (Tropico-tier).
//
// government.js (1,379 LOC) handles realm-level voting + zoning policy
// + services dispatch. This wave extends with mayor-controlled
// budgets, citizen happiness aggregation, policy levers that bind
// to faction_strategy_state, and per-department resource allocation.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS city_budgets (
      world_id            TEXT PRIMARY KEY,
      tax_rate_pct        REAL NOT NULL DEFAULT 12
                            CHECK (tax_rate_pct >= 0 AND tax_rate_pct <= 90),
      treasury_cents      INTEGER NOT NULL DEFAULT 100000,
      housing_alloc_pct   REAL NOT NULL DEFAULT 20,
      health_alloc_pct    REAL NOT NULL DEFAULT 15,
      safety_alloc_pct    REAL NOT NULL DEFAULT 25,
      infra_alloc_pct     REAL NOT NULL DEFAULT 20,
      culture_alloc_pct   REAL NOT NULL DEFAULT 10,
      welfare_alloc_pct   REAL NOT NULL DEFAULT 10,
      last_tick_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS city_policies (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN (
                        'curfew','free_healthcare','open_borders','progressive_tax',
                        'martial_law','arts_subsidy','industrial_subsidy','rent_control'
                      )),
      enacted_by_user TEXT,
      enacted_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      repealed_at     INTEGER,
      payload_json    TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_city_policies_active
      ON city_policies (world_id, kind) WHERE repealed_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS city_happiness_snapshot (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      tick_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      overall_pct     REAL NOT NULL CHECK (overall_pct >= 0 AND overall_pct <= 100),
      housing_pct     REAL NOT NULL DEFAULT 50,
      health_pct      REAL NOT NULL DEFAULT 50,
      safety_pct      REAL NOT NULL DEFAULT 50,
      infra_pct       REAL NOT NULL DEFAULT 50,
      culture_pct     REAL NOT NULL DEFAULT 50,
      welfare_pct     REAL NOT NULL DEFAULT 50,
      faction_alignments_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_city_happiness_world_ts ON city_happiness_snapshot (world_id, tick_at DESC);
  `);
}

export const description = "Phase II Wave 18 — city institution: budgets, policies, happiness snapshots";
