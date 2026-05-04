// server/migrations/099_user_storage.js
//
// Per-user storage quota with earned expansion through creator activity.
//
// Concord rejects subscription tiers — the platform's economics rest on
// the marketplace fee + Concord Coin + creator royalties, not recurring
// fees. Every user gets a generous flat baseline (5 GiB), and storage
// expands automatically as their work accumulates: royalty payouts
// received, DTUs promoted to MEGA, marketplace sales completed. Lurkers
// stay at the baseline; active creators outgrow it without ever paying.
//
// Enforcement is on artifact uploads (audio / image / PDF / video) —
// the byte-heavy path. DTU creation itself is unmetered.
//
// Schema:
//   users.storage_bytes_used      Running counter, updated on upload/delete.
//   users.storage_bytes_quota     Current cap. Defaults to 5 GiB; grants raise it.
//   storage_audit                 Per-event ledger so every byte change is traceable.

export function up(db) {
  // ALTER TABLE ADD COLUMN is idempotent-safe via try/catch since SQLite
  // throws on re-add; existing rows get the DEFAULT applied automatically.
  const addColumn = (sql) => {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || "").includes("duplicate column")) throw e;
    }
  };

  addColumn(`ALTER TABLE users ADD COLUMN storage_bytes_used INTEGER NOT NULL DEFAULT 0`);
  addColumn(`ALTER TABLE users ADD COLUMN storage_bytes_quota INTEGER NOT NULL DEFAULT 5368709120`); // 5 GiB

  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_audit (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      delta_bytes  INTEGER NOT NULL,
      reason       TEXT NOT NULL,
      artifact_id  TEXT,
      grant_key    TEXT,
      occurred_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_storage_audit_user
      ON storage_audit(user_id, occurred_at DESC);
    -- grant_key makes earning hooks idempotent: each (royalty payout id,
    -- mega id, sale id) maps to at most one grant row.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_audit_grant_key
      ON storage_audit(grant_key) WHERE grant_key IS NOT NULL;
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
