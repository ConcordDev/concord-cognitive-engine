// Migration 274 — heart-event milestones (H3).
//
// Tracks which affinity-milestone scenes a player has already seen with a
// given partner, so each authored heart event plays exactly once. Distinct
// from player_courtship (the affinity ledger) — this is the scene-seen log.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_heart_events_seen (
      player_user_id  TEXT NOT NULL,
      partner_kind    TEXT NOT NULL,
      partner_id      TEXT NOT NULL,
      milestone_id    TEXT NOT NULL,
      seen_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (player_user_id, partner_kind, partner_id, milestone_id)
    );
    CREATE INDEX IF NOT EXISTS idx_heart_events_player
      ON player_heart_events_seen (player_user_id, partner_kind, partner_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_heart_events_player;
    DROP TABLE IF EXISTS player_heart_events_seen;
  `);
}
