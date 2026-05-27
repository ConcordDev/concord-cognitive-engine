// server/migrations/219_party_lfg.js
//
// Phase U5 — LFG matchmaking + raid party variant.
//
// `parties` already exists from migration 070 with max_size=8 default.
// We add a `party_type` column ('normal' vs 'raid') and a new
// lfg_requests table for matchmaking.

export function up(db) {
  // Best-effort ALTER — minimal builds may not have the parties table.
  try {
    db.exec(`ALTER TABLE parties ADD COLUMN party_type TEXT NOT NULL DEFAULT 'normal' CHECK (party_type IN ('normal','raid'));`);
  } catch (err) {
    if (!String(err?.message || "").includes("duplicate column") &&
        !String(err?.message || "").includes("no such table")) {
      throw err;
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS lfg_requests (
      id                  TEXT PRIMARY KEY,
      requester_user_id   TEXT NOT NULL,
      world_id            TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'any'
                          CHECK (role IN ('tank','healer','dps','support','any')),
      party_id            TEXT,
      party_type          TEXT NOT NULL DEFAULT 'normal'
                          CHECK (party_type IN ('normal','raid')),
      status              TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','matched','cancelled','expired')),
      note                TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at          INTEGER NOT NULL DEFAULT (unixepoch() + 3600),
      matched_at          INTEGER,
      party_max_size      INTEGER NOT NULL DEFAULT 8,
      current_party_size  INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_lfg_open_world
      ON lfg_requests(world_id, status, role, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lfg_requester
      ON lfg_requests(requester_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_lfg_expiry
      ON lfg_requests(status, expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_lfg_expiry;
    DROP INDEX IF EXISTS idx_lfg_requester;
    DROP INDEX IF EXISTS idx_lfg_open_world;
    DROP TABLE IF EXISTS lfg_requests;
  `);
}
