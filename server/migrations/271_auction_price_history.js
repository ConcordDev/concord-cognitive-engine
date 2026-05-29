// server/migrations/271_auction_price_history.js
//
// D1 / F7.1 — marketplace depth. The auction house tracked only the last 20
// bids on a single live auction (a snapshot, not a market). This adds a
// per-item sale-price time series so a price-history graph + appreciation curve
// can render, and feeds the order-book depth view.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auction_price_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     TEXT NOT NULL,
      item_kind   TEXT,
      world_id    TEXT,
      sale_cc     REAL NOT NULL,
      auction_id  TEXT,
      sold_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_price_hist_item ON auction_price_history(item_id, sold_at);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS auction_price_history;`);
}
