// server/migrations/305_civic_bonds.js
//
// Civic Capital — persistence for the micro-bond governance engine.
//
// The engine (server/emergent/microbond-governance.js) was in-memory only, so
// every bond/pledge/vote died on restart. These tables give it a durable,
// sparks-denominated backing store. The new server/lib/civic-bonds.js reads/
// writes these; the legacy in-memory engine + its sovereign-emergent routes
// stay untouched (kill-switch CONCORD_CIVIC_BONDS, off = today).
//
// All money here is SPARKS (Concordia's in-world currency), never Concord Coin.
// Append-only migration. Shapes mirror the engine's Maps (spec §3).

export function up(db) {
  // The bond itself — one per civic-project drive.
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_bonds (
      id                 TEXT PRIMARY KEY,
      world_id           TEXT NOT NULL,
      realm_id           TEXT,                          -- nullable: faction/org/hub bonds allowed
      faction_id         TEXT,
      org_id             TEXT,
      proposer_id        TEXT,                          -- the ruler/leader/officer who opened it
      title              TEXT NOT NULL,
      description        TEXT,
      category           TEXT,                          -- infrastructure | equipment | civic ...
      scope              TEXT NOT NULL DEFAULT 'city',  -- GOVERNANCE_SCOPES
      labor_source       TEXT NOT NULL DEFAULT 'contract' -- in_house (cheaper) | contract (spec §10)
                           CHECK (labor_source IN ('in_house', 'contract')),
      -- financial (sparks)
      target_amount      INTEGER NOT NULL,
      current_pledged    INTEGER NOT NULL DEFAULT 0,
      denomination       INTEGER NOT NULL DEFAULT 100,  -- min pledge unit
      return_rate        REAL NOT NULL DEFAULT 0.005,   -- CAPPED (governance.js civic.return_rate_max)
      spillover_rate     REAL NOT NULL DEFAULT 0.05,
      funding_gate_pct   REAL NOT NULL DEFAULT 1.10,    -- the 110% pre-funding gate (policy core)
      -- governance / lifecycle
      voting_status      TEXT NOT NULL DEFAULT 'proposed',
      quorum             INTEGER NOT NULL DEFAULT 1000,
      approval_threshold REAL NOT NULL DEFAULT 0.6,
      votes_for          INTEGER NOT NULL DEFAULT 0,
      votes_against      INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed','voting','funding','funded','active','paused','completed','failed','cancelled')),
      decree_id          TEXT,                          -- the construction decree this bond pays for
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      funded_at          INTEGER,
      completed_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_civic_bonds_world ON civic_bonds(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_civic_bonds_realm ON civic_bonds(realm_id);
  `);

  // Per-contributor pledges — escrowed up front, refundable until activation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_bond_pledges (
      id              TEXT PRIMARY KEY,
      bond_id         TEXT NOT NULL,
      entity_kind     TEXT NOT NULL DEFAULT 'player'    -- player | npc
                        CHECK (entity_kind IN ('player','npc')),
      entity_id       TEXT NOT NULL,
      amount          INTEGER NOT NULL,                 -- escrowed via sparks-service at pledge
      return_reserved INTEGER NOT NULL DEFAULT 0,       -- capped return escrowed at fund time
      status          TEXT NOT NULL DEFAULT 'escrowed'
                        CHECK (status IN ('escrowed','delivered','refunded')),
      pledged_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(bond_id, entity_kind, entity_id)           -- one pledge row per entity per bond
    );
    CREATE INDEX IF NOT EXISTS idx_civic_pledges_bond ON civic_bond_pledges(bond_id, status);
    CREATE INDEX IF NOT EXISTS idx_civic_pledges_entity ON civic_bond_pledges(entity_id);
  `);

  // Votes — the proposal-approval gate. PK makes a re-vote idempotent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_bond_votes (
      bond_id   TEXT NOT NULL,
      voter_id  TEXT NOT NULL,
      vote      TEXT NOT NULL CHECK (vote IN ('for','against','abstain')),
      cast_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (bond_id, voter_id)
    );
  `);

  // Milestones — fund-release gates + audit checkpoints.
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_bond_milestones (
      id           TEXT PRIMARY KEY,
      bond_id      TEXT NOT NULL,
      idx          INTEGER NOT NULL,
      description  TEXT,
      release_pct  REAL NOT NULL DEFAULT 0,             -- % of capital released on completion
      status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','complete')),
      completed_at INTEGER,
      UNIQUE(bond_id, idx)
    );
  `);

  // Spillover by scope — restricted residue that seeds the next project.
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_spillover_funds (
      scope      TEXT NOT NULL,
      world_id   TEXT NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (scope, world_id)
    );
  `);
}
