// Migration 507 — SB-21: the skill purchase record. One row per
// purchase attempt that reached settlement: written 'pending' inside
// the purchase transaction, completed only once the grant exists, or
// 'refunded' when the grant failed and the compensating refund settled.
// The idempotency key (caller-supplied) is unique where present, so a
// repeated key can only ever name the original purchase.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_purchases (
      id               TEXT PRIMARY KEY,
      buyer_id         TEXT NOT NULL,
      seller_id        TEXT NOT NULL,
      listing_id       TEXT NOT NULL,
      skill_dtu_id     TEXT NOT NULL,
      price_cc         REAL NOT NULL,
      fee_cc           REAL NOT NULL,
      seller_net_cc    REAL NOT NULL,
      idempotency_key  TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      new_skill_dtu_id TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at     INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_purchases_idem
      ON skill_purchases(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_skill_purchases_buyer
      ON skill_purchases(buyer_id, listing_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS skill_purchases`);
}
