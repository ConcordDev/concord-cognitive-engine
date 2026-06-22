// server/migrations/342_contribution_quests.js
//
// Contribution Quests (#36) — a quest whose completion criterion is VERIFIABLE
// real contribution: author N DTUs in a target lens after the quest opens. No
// self-reported progress — the count is measured from the dtus table. On
// completion the sponsor's posted reward becomes claimable (minted through the
// existing earned-CC path, idempotent on a refId). Connects real authoring
// activity to the economy + goal layer.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contribution_quests (
      id           TEXT PRIMARY KEY,
      sponsor_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      target_lens  TEXT NOT NULL,                     -- the lens/domain DTUs must be authored in
      target_count INTEGER NOT NULL DEFAULT 1,
      reward_cc    REAL NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'open',      -- open | closed
      start_ts     INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cq_open ON contribution_quests(status, target_lens)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contribution_quest_claims (
      quest_id          TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      contributed       INTEGER NOT NULL DEFAULT 0,
      completed_at      INTEGER,
      reward_claimed_at INTEGER,
      reward_minted     INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (quest_id, user_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cqc_user ON contribution_quest_claims(user_id)`);
}
