// server/migrations/069_player_trade.js
// Player-to-player trade with both-sides-confirm escrow.
// Models on the wager flow (migration 051) but for items + coins.
//
// State machine:
//   pending           — session created, no offers yet
//   both_offered      — both sides have set an offer
//   initiator_ready   — initiator hit Ready; recipient still editing
//   recipient_ready   — recipient hit Ready; initiator still editing
//   complete          — both ready + atomic transfer succeeded
//   cancelled         — cancelled by either party or verification failure
//   expired           — auto-cancelled past expires_at without completion

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_trades (
        id                   TEXT PRIMARY KEY,
        initiator_id         TEXT NOT NULL,
        recipient_id         TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'both_offered', 'initiator_ready', 'recipient_ready', 'complete', 'cancelled', 'expired')),
        initiator_offer_json TEXT NOT NULL DEFAULT '{"items":[],"sparks":0,"cc":0}',
        recipient_offer_json TEXT NOT NULL DEFAULT '{"items":[],"sparks":0,"cc":0}',
        initiator_ready_at   INTEGER,
        recipient_ready_at   INTEGER,
        completed_at         INTEGER,
        cancelled_at         INTEGER,
        cancelled_by         TEXT,
        cancel_reason        TEXT,
        created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at           INTEGER NOT NULL,
        FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_player_trades_initiator ON player_trades(initiator_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_player_trades_recipient ON player_trades(recipient_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_player_trades_status ON player_trades(status, expires_at)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  // Inventory reservation columns: when an item is offered in an active trade,
  // it is reserved until the trade completes / cancels / expires. Prevents
  // double-spending the same item across two simultaneous trades.
  // Uses ALTER TABLE ADD COLUMN — sqlite supports this without table rebuild.
  try {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN reserved_until INTEGER`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }
  try {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN reserved_by TEXT`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }

  // Soulbound flag — items flagged true cannot be traded.
  // Default false (0) for back-compat with all existing inventory rows.
  try {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN soulbound INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }
}
