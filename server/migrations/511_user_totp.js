// Two-factor authentication (FIX-settings-005): per-user TOTP state and
// single-use recovery codes.
//
// user_totp holds ONE row per user who has started enrolment:
// secret_enc is the TOTP secret encrypted at rest (lib/totp.js, the
// platform's enc:v1 AES-256-GCM format); enabled stays 0 while the
// secret is pending confirmation and flips to 1 only when the user
// proves possession with a valid code; last_step records the highest
// accepted TOTP counter so a code cannot be replayed inside its
// validity window. user_totp_recovery holds the SHA-256 hash of each
// recovery code (plaintext is shown exactly once, at issue) with
// used_at stamping consumption.
//
// Guarded CREATEs so a partially-migrated DB stays bootable; both
// tables are inert until a user enrols.
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_totp (
      user_id TEXT PRIMARY KEY,
      secret_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_step INTEGER NOT NULL DEFAULT -1,
      created_at INTEGER NOT NULL DEFAULT 0,
      confirmed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS user_totp_recovery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_user_totp_recovery_user
      ON user_totp_recovery (user_id, used_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS user_totp_recovery;
    DROP TABLE IF EXISTS user_totp;
  `);
}
