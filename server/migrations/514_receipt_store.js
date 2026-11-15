// server/migrations/514_receipt_store.js
//
// Durable store for signed calc receipts (concord-calc-receipt/2 and any
// other attested receipt a caller chooses to keep). Live demo and chem-lens
// receipts were signed over their outputs but never stored, so an id could
// not be read back. The full receipt JSON is kept exactly as signed; the
// columns beside it are lookup keys only and are never trusted over the
// signed body.
//
// receipt_id : rcpt_<uuid>, generated BEFORE signing and placed inside the
//              signed body (so the signature covers it). NULL for a stored
//              v1/v2 receipt that predates ids; those are fetched by digest.
// digest     : SHA-256 of the canonical signed bytes (signature.digest).
//              UNIQUE: storing the same signed receipt twice is a no-op.
// No user columns: receipts are calculation artifacts, not account records.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_store (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT,
      digest TEXT NOT NULL,
      schema TEXT NOT NULL,
      key_id TEXT,
      issuer TEXT,
      issued_at TEXT,
      receipt_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_store_digest ON receipt_store (digest);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_store_receipt_id ON receipt_store (receipt_id) WHERE receipt_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_receipt_store_receipt_id;
    DROP INDEX IF EXISTS idx_receipt_store_digest;
    DROP TABLE IF EXISTS receipt_store;
  `);
}
