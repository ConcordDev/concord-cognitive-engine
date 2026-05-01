// server/migrations/071_inventory_audit.js
// Inventory audit log + anomaly queue for anti-duplication safeguards.
// Phase 10 of polish-to-ten.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_audit_log (
        id              TEXT PRIMARY KEY,
        ts              INTEGER NOT NULL DEFAULT (unixepoch()),
        actor_user_id   TEXT,
        from_user_id    TEXT,
        to_user_id      TEXT,
        item_id         TEXT,
        item_name       TEXT,
        delta           INTEGER NOT NULL,
        category        TEXT NOT NULL
                          CHECK (category IN (
                            'trade', 'craft', 'quest_reward', 'shop_buy', 'shop_sell',
                            'loot', 'gift', 'consume', 'admin', 'system', 'other'
                          )),
        ref_id          TEXT,
        before_qty      INTEGER,
        after_qty       INTEGER,
        notes           TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_audit_ts ON inventory_audit_log(ts DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_audit_item ON inventory_audit_log(item_id, ts DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_audit_user ON inventory_audit_log(from_user_id, to_user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_audit_ref ON inventory_audit_log(ref_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_anomaly_queue (
        id           TEXT PRIMARY KEY,
        detected_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        kind         TEXT NOT NULL
                       CHECK (kind IN (
                         'negative_quantity', 'orphan_reservation',
                         'lineage_break', 'rapid_duplication', 'manual_review'
                       )),
        user_id      TEXT,
        item_id      TEXT,
        inventory_id TEXT,
        details_json TEXT,
        status       TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
        resolved_at  INTEGER,
        resolved_by  TEXT,
        resolution   TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_anomaly_status ON inventory_anomaly_queue(status, detected_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inv_anomaly_user ON inventory_anomaly_queue(user_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
