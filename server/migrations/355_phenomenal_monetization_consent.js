// server/migrations/355_phenomenal_monetization_consent.js
//
// Adds the `allow_phenomenal_monetization` consent action to `user_consent`.
//
// docs/GOVERNANCE_DESIGN.md §2.2 (owner-approved 2026-07-03) names this gate:
// monetizing a phenomenal-derived artifact (a dream DTU is explicitly named
// as phenomenal data in §2.1) is a strictly higher bar than merely listing
// it for free/citation purposes, and requires its own, separate,
// revocable-for-future-listings consent. `server/lib/consent.js` adds the
// CONSENT_ACTIONS entry; this migration widens the DB-level CHECK so
// `grantConsent`/`revokeConsent` can actually persist a row for it — without
// this, every grant attempt would hit the CHECK constraint and fail closed
// with `consent_grant_failed`, silently disabling the feature.
//
// Only `allow_phenomenal_monetization` is added here. The related
// `allow_phenomenal_influence` / `allow_fork_of_self` gates sketched in the
// same design doc section are NOT part of this migration — they're separate,
// unbuilt Wave-1 items (fork/reenactment consent is explicitly out of scope
// for this unit).
//
// SQLite cannot ALTER a CHECK constraint, so — per the migration 100
// precedent (evo_assets CHECK widening) — the table is recreated with the
// extended CHECK and every existing row is copied across unchanged.

export function up(db) {
  // The migrate.js runner wraps every migration in its own db.transaction();
  // don't start a nested one here (see migration 100's note — nested SQLite
  // transactions throw).
  const fkBefore = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec("ALTER TABLE user_consent RENAME TO user_consent_v1");

    db.exec(`
      CREATE TABLE user_consent (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL
          CHECK (action IN (
            'publish_to_marketplace',
            'publish_to_regional',
            'publish_to_feed',
            'promote_to_national',
            'promote_to_global',
            'show_profile_regional',
            'show_profile_national',
            'show_profile_global',
            'allow_citation',
            'allow_emergent_learning',
            'allow_global_dtu_creation',
            'allow_phenomenal_monetization'
          )),
        granted INTEGER NOT NULL DEFAULT 0
          CHECK (granted IN (0, 1)),
        granted_at TEXT,
        revoked_at TEXT,
        revocable INTEGER NOT NULL DEFAULT 1
          CHECK (revocable IN (0, 1)),
        prompt_text TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, action)
      )
    `);

    db.exec(`
      INSERT INTO user_consent (
        id, user_id, action, granted, granted_at, revoked_at,
        revocable, prompt_text, updated_at
      )
      SELECT
        id, user_id, action, granted, granted_at, revoked_at,
        revocable, prompt_text, updated_at
      FROM user_consent_v1
    `);

    db.exec("DROP TABLE user_consent_v1");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_consent_user
        ON user_consent(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_consent_action
        ON user_consent(action, granted);
    `);
  } finally {
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
  }
}

export function down(db) {
  // Widening-only migration; no safe narrowing down-path (would require
  // deleting any 'allow_phenomenal_monetization' rows first). No-op.
}
