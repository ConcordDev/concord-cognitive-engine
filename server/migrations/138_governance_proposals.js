// Migration 138 — Governance: proposals + votes on constitutional constants.
//
// The royalty rates, marketplace fee, withdrawal hold, etc. are
// constitutional — they're documented as gated by governance approval.
// This migration gives that governance an actual surface: a proposal +
// vote ledger that reads can quorum + tally.
//
// Tables:
//   governance_proposals  — one row per open proposal
//   governance_votes      — one row per voter+proposal

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_proposals (
      id              TEXT    PRIMARY KEY,
      title           TEXT    NOT NULL,
      summary         TEXT    NOT NULL,
      proposer_id     TEXT    NOT NULL,
      constant_path   TEXT    NOT NULL,
      current_value   TEXT    NOT NULL,
      proposed_value  TEXT    NOT NULL,
      rationale       TEXT,
      status          TEXT    NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'passed', 'rejected', 'withdrawn')),
      quorum          INTEGER NOT NULL DEFAULT 5,
      threshold_pct   REAL    NOT NULL DEFAULT 0.66,
      opened_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at       INTEGER,
      closes_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gov_prop_status   ON governance_proposals(status, closes_at);
    CREATE INDEX IF NOT EXISTS idx_gov_prop_proposer ON governance_proposals(proposer_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_votes (
      proposal_id   TEXT    NOT NULL,
      voter_id      TEXT    NOT NULL,
      vote          TEXT    NOT NULL CHECK (vote IN ('yes', 'no', 'abstain')),
      cast_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (proposal_id, voter_id)
    );
  `);
}

export function down(_db) { /* forward-only */ }
