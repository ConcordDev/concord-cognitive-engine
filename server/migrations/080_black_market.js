// server/migrations/080_black_market.js
//
// The black market for intercepted Concord Link messages. The intercepted
// status was added in migration 076 but had no retrieval mechanism — this
// table is where intercepted messages get surfaced for resale, with the
// sender/receiver redacted and the encryption_level driving the price tier.
//
// Currency is sparks. There are no real-money codepaths anywhere.
//
// Two tables:
//   black_market_listings  — one row per surfaced intercepted message.
//                            status = active | sold | expired.
//   black_market_reputation — per-buyer rep with each fence. Repeat buyers
//                            see better prices; first-time buyers may pay a
//                            premium until they establish standing.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS black_market_listings (
        id                 TEXT PRIMARY KEY,
        message_id         TEXT NOT NULL,
        fence_npc_id       TEXT NOT NULL,
        price_sparks       INTEGER NOT NULL DEFAULT 0,
        encryption_level   TEXT NOT NULL DEFAULT 'basic',
        redacted_preview   TEXT,
        status             TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'sold', 'expired', 'cancelled')),
        buyer_id           TEXT,
        sold_at            INTEGER,
        sale_price         INTEGER,
        created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at         INTEGER NOT NULL DEFAULT (unixepoch() + 86400 * 7)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_black_market_status   ON black_market_listings(status, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_black_market_fence    ON black_market_listings(fence_npc_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_black_market_message  ON black_market_listings(message_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_black_market_expiry   ON black_market_listings(expires_at)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS black_market_reputation (
        user_id        TEXT NOT NULL,
        fence_npc_id   TEXT NOT NULL,
        buyer_rep      INTEGER NOT NULL DEFAULT 0,
        purchases      INTEGER NOT NULL DEFAULT 0,
        last_trade_at  INTEGER,
        PRIMARY KEY (user_id, fence_npc_id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_black_market_rep_user ON black_market_reputation(user_id)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }
}
