// server/migrations/175_realm_exiles.js
//
// Concordia Phase 4 — opinion-driven realm access + exile.
//
// realms (mig 158) governs who rules; this migration adds the
// exile ledger that enforces opinion-driven access. When a user's
// aggregate opinion across a realm's NPC guards drops below -50,
// they're refused entry. Below -80, they're written into realm_exiles
// and position updates inside the realm's bounds are blocked.
//
// `expires_at` NULL means an indefinite exile (until the realm
// changes ruler OR an explicit pardon decree from realm_decrees
// flips it). Pardon support is in lib/realm-access.js#pardonExile.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS realm_exiles (
      realm_id     TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      reason       TEXT    NOT NULL DEFAULT 'opinion_below_threshold',
      exiled_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER,
      pardoned_at  INTEGER,
      pardoned_by  TEXT,
      PRIMARY KEY (realm_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_exile_user ON realm_exiles(user_id, pardoned_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_exile_expiry ON realm_exiles(expires_at) WHERE expires_at IS NOT NULL`);
}

export function down(_db) {
  // Forward-only — exile history is forensic trail.
}
