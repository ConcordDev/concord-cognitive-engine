// server/migrations/227_auction_buy_orders.js
//
// Phase AC — EVE-style buy orders on the auction house.
//
// Today's auction is sell-only. Add the buy side: a player posts
// "I'll pay 5 CC each for 100 rare herbs" and the next seller fills
// the order in one click. Critical for early-game economy when sell
// listings are thin.
//
// Escrow rule: buyer's wallet is debited up-front by
// unit_price_cc × quantity_wanted on placeBuyOrder. Cancel/expire
// refunds the unfilled portion.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auction_buy_orders (
      id                  TEXT PRIMARY KEY,
      buyer_user_id       TEXT NOT NULL,
      world_id            TEXT NOT NULL,
      item_kind           TEXT NOT NULL CHECK (item_kind IN ('dtu','inventory')),
      item_descriptor     TEXT NOT NULL,
      item_filter_json    TEXT,
      unit_price_cc       REAL NOT NULL CHECK (unit_price_cc > 0),
      quantity_wanted     INTEGER NOT NULL CHECK (quantity_wanted > 0),
      quantity_filled     INTEGER NOT NULL DEFAULT 0,
      total_escrow_cc     REAL NOT NULL,
      status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','partial','filled','cancelled','expired')),
      posted_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_buy_orders_world_item
      ON auction_buy_orders(world_id, item_descriptor, status);
    CREATE INDEX IF NOT EXISTS idx_buy_orders_buyer
      ON auction_buy_orders(buyer_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_buy_orders_expiry
      ON auction_buy_orders(expires_at) WHERE status IN ('open','partial');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auction_buy_fills (
      id                  TEXT PRIMARY KEY,
      buy_order_id        TEXT NOT NULL,
      seller_user_id      TEXT NOT NULL,
      quantity            INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cc       REAL NOT NULL,
      filled_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (buy_order_id) REFERENCES auction_buy_orders(id)
    );
    CREATE INDEX IF NOT EXISTS idx_buy_fills_order
      ON auction_buy_fills(buy_order_id);
    CREATE INDEX IF NOT EXISTS idx_buy_fills_seller
      ON auction_buy_fills(seller_user_id, filled_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_buy_fills_seller;
    DROP INDEX IF EXISTS idx_buy_fills_order;
    DROP TABLE IF EXISTS auction_buy_fills;
    DROP INDEX IF EXISTS idx_buy_orders_expiry;
    DROP INDEX IF EXISTS idx_buy_orders_buyer;
    DROP INDEX IF EXISTS idx_buy_orders_world_item;
    DROP TABLE IF EXISTS auction_buy_orders;
  `);
}
