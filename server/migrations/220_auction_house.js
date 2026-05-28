// server/migrations/220_auction_house.js
//
// Phase V1 — auction house. Time-bound bidding with optional buy-now.
// Distinct from the marketplace (fixed-price, royalty-cascading).
//
// Wallet holds are tracked in auction_bids — the latest leading bid is
// the active hold; prior bidders are refunded as soon as they're outbid.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id                    TEXT PRIMARY KEY,
      seller_user_id        TEXT NOT NULL,
      world_id              TEXT,
      item_kind             TEXT NOT NULL CHECK (item_kind IN ('dtu','inventory')),
      item_id               TEXT NOT NULL,
      title                 TEXT NOT NULL DEFAULT '',
      start_cc              REAL NOT NULL DEFAULT 0,
      current_bid_cc        REAL NOT NULL DEFAULT 0,
      buyout_cc             REAL,
      bid_count             INTEGER NOT NULL DEFAULT 0,
      leading_bidder_user_id TEXT,
      starts_at             INTEGER NOT NULL DEFAULT (unixepoch()),
      ends_at               INTEGER NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','sold','cancelled','expired')),
      settled_at            INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auctions_active
      ON auctions(status, ends_at);
    CREATE INDEX IF NOT EXISTS idx_auctions_seller
      ON auctions(seller_user_id, status);

    CREATE TABLE IF NOT EXISTS auction_bids (
      id              TEXT PRIMARY KEY,
      auction_id      TEXT NOT NULL,
      bidder_user_id  TEXT NOT NULL,
      amount_cc       REAL NOT NULL,
      placed_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      refunded_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auction_bids_auction
      ON auction_bids(auction_id, placed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder
      ON auction_bids(bidder_user_id, refunded_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_auction_bids_bidder;
    DROP INDEX IF EXISTS idx_auction_bids_auction;
    DROP TABLE IF EXISTS auction_bids;
    DROP INDEX IF EXISTS idx_auctions_seller;
    DROP INDEX IF EXISTS idx_auctions_active;
    DROP TABLE IF EXISTS auctions;
  `);
}
