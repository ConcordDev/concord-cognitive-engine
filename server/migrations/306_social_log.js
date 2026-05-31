// server/migrations/306_social_log.js
//
// Slice-of-Life SL1 — the everyday-verb ledger. Player daily-living verbs
// (hang_out / share_meal / go_drinking / spend_evening / gift) write here so
// they have cooldowns + consecutive-day streaks (a rhythm, not a spam button).
// Append-only. The verbs route their affinity through romance courtInteraction
// and their consequence through recordOpinionEvent; this table is just cadence.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_social_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      verb         TEXT NOT NULL
                     CHECK (verb IN ('hang_out','share_meal','go_drinking','spend_evening','gift')),
      partner_kind TEXT NOT NULL DEFAULT 'npc',     -- 'npc' | 'player'
      partner_id   TEXT NOT NULL,
      world_id     TEXT NOT NULL DEFAULT 'concordia-hub',
      streak       INTEGER NOT NULL DEFAULT 1,
      at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_social_log_user_partner
      ON player_social_log (user_id, verb, partner_kind, partner_id, at DESC);
  `);
}
