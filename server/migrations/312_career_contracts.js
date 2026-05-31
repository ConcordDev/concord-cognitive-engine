// server/migrations/312_career_contracts.js
//
// WAVE JOBS — persisted contract negotiation (the dormant world-jobs/trades
// concept, now DB-backed + wallet-wired). An employer↔worker employment contract
// with a negotiation state machine (offer→counter→accept/reject) + bonuses +
// clauses (release / match-highest / hazard-pay). Players hire players, NPCs hire
// players, players hire NPCs. Wages move in SPARKS via sparks-service. Append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS career_contracts (
      id                   TEXT PRIMARY KEY,
      world_id             TEXT,
      employer_kind        TEXT NOT NULL,                 -- 'player' | 'npc' | 'org'
      employer_id          TEXT NOT NULL,
      worker_kind          TEXT NOT NULL,                 -- 'player' | 'npc'
      worker_id            TEXT NOT NULL,
      track_id             TEXT NOT NULL,                 -- professions.js track
      tier                 INTEGER NOT NULL DEFAULT 1,
      role                 TEXT,
      base_wage_sparks     INTEGER NOT NULL DEFAULT 0,
      pay_model            TEXT NOT NULL DEFAULT 'per_shift', -- per_shift | salary | piece
      duration_days        INTEGER NOT NULL DEFAULT 30,
      signing_bonus_sparks INTEGER NOT NULL DEFAULT 0,
      bonuses_json         TEXT NOT NULL DEFAULT '[]',     -- [{trigger, amount}]
      clauses_json         TEXT NOT NULL DEFAULT '[]',     -- ['release','match_highest','hazard_pay']
      status               TEXT NOT NULL DEFAULT 'offered'
                             CHECK (status IN ('offered','countered','active','rejected','completed','expired')),
      last_offer_by        TEXT,                           -- 'kind:id' of the party with the standing offer
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_career_contracts_worker   ON career_contracts(worker_kind, worker_id, status);
    CREATE INDEX IF NOT EXISTS idx_career_contracts_employer ON career_contracts(employer_kind, employer_id, status);

    CREATE TABLE IF NOT EXISTS career_contract_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      kind        TEXT NOT NULL,                            -- offer | counter | accept | reject
      by_kind     TEXT,
      by_id       TEXT,
      terms_json  TEXT,
      at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_career_contract_events ON career_contract_events(contract_id, at);
  `);
}

export function down(_db) { /* append-only */ }
