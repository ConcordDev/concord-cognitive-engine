// server/migrations/162_spectator_betting.js
//
// Phase 9.2 — Live spectator + emergent broadcast.
//
//   - prediction_markets: open markets on emergent outcomes
//   - market_positions: per-user wagers (in SPARKS — non-extractive)
//   - goddess_dispatches: hourly composed dispatches from the
//     Concordia goddess based on ecosystem_score + refusal-field +
//     drift state
//   - spectator_sessions: ephemeral read-only viewers attached to a
//     world (dedup by session token)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_markets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT,
      question TEXT NOT NULL,
      resolution_kind TEXT NOT NULL,
      resolution_ref TEXT,
      pool_yes_sparks INTEGER NOT NULL DEFAULT 0,
      pool_no_sparks INTEGER NOT NULL DEFAULT 0,
      opened_at INTEGER NOT NULL DEFAULT (unixepoch()),
      closes_at INTEGER,
      resolved_at INTEGER,
      resolved_outcome TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pred_mkt_status ON prediction_markets(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pred_mkt_world ON prediction_markets(world_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      stake_sparks INTEGER NOT NULL,
      placed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      payout_sparks INTEGER,
      paid_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mkt_pos_market ON market_positions(market_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mkt_pos_user ON market_positions(user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS goddess_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      tone TEXT NOT NULL,
      ecosystem_score REAL,
      refusal_strength REAL,
      drift_kind TEXT,
      body TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_god_dispatch_world ON goddess_dispatches(world_id, composed_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS spectator_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      viewer_user_id TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_spectator_world ON spectator_sessions(world_id, last_seen_at DESC)`);
}
