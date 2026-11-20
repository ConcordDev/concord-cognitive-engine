// server/migrations/515_market_house.js
//
// The Auction House (Market lens). Lots themselves are rows in
// marketplace_economy_listings (economy/marketplace-service.js) and sales are
// rows in `purchases` + economy_ledger; nothing here duplicates them.
//
// house_showcase_entries : a creator's entry for ONE coming hour (hour_key is
//                          the UTC hour, "2026-11-19T14"). Entries for an hour
//                          close when that hour begins.
// house_showcase_draws   : the drawing for an hour, kept exactly as drawn: the
//                          seed, the previous seed it chains from, the frozen
//                          entrant list and the winners, so anyone can redo it.
// house_commissions      : a request posted to the pay board, with the reward
//                          held in __ESCROW__ (escrow_held is what the ledger
//                          actually put in escrow, after the transfer fee).
// house_commission_submissions : a creator's DTU offered against a commission,
//                          with the server's criteria checks as run.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS house_showcase_entries (
      hour_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (hour_key, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_house_showcase_entries_user ON house_showcase_entries (user_id, hour_key);

    CREATE TABLE IF NOT EXISTS house_showcase_draws (
      hour_key TEXT PRIMARY KEY,
      seed TEXT NOT NULL,
      prev_seed TEXT NOT NULL,
      entrants_json TEXT NOT NULL,
      excluded_json TEXT NOT NULL DEFAULT '[]',
      winners_json TEXT NOT NULL,
      drawn_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS house_commissions (
      id TEXT PRIMARY KEY,
      poster_id TEXT NOT NULL,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      reward REAL NOT NULL CHECK (reward > 0),
      escrow_held REAL NOT NULL CHECK (escrow_held >= 0),
      hold_fee REAL NOT NULL DEFAULT 0,
      criteria_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'cancelled', 'expired')),
      deadline TEXT NOT NULL,
      awarded_submission_id TEXT,
      released_net REAL,
      released_fee REAL,
      refunded REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_house_commissions_status ON house_commissions (status, deadline);
    CREATE INDEX IF NOT EXISTS idx_house_commissions_poster ON house_commissions (poster_id, created_at);

    CREATE TABLE IF NOT EXISTS house_commission_submissions (
      id TEXT PRIMARY KEY,
      commission_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      checks_json TEXT NOT NULL DEFAULT '[]',
      passed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'declined', 'withdrawn')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (commission_id, dtu_id)
    );
    CREATE INDEX IF NOT EXISTS idx_house_subs_commission ON house_commission_submissions (commission_id, status);
    CREATE INDEX IF NOT EXISTS idx_house_subs_creator ON house_commission_submissions (creator_id, created_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS house_commission_submissions;
    DROP TABLE IF EXISTS house_commissions;
    DROP TABLE IF EXISTS house_showcase_draws;
    DROP TABLE IF EXISTS house_showcase_entries;
  `);
}

export const description = "Auction House: hourly showcase drawings and the commission pay board";
