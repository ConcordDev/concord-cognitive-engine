// server/migrations/222_event_rsvp.js
//
// Phase V4 — persistent RSVPs to world events.
//
// world_events is in-memory; this stores RSVPs durably so reminders fire
// and the personal calendar survives restarts.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_event_rsvps (
      event_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'attendee'
                    CHECK (role IN ('attendee','interested','host')),
      world_id      TEXT,
      starts_at     INTEGER,
      rsvp_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      reminded_at   INTEGER,
      title         TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (event_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_rsvps_user
      ON world_event_rsvps(user_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_event_rsvps_pending_reminder
      ON world_event_rsvps(starts_at, reminded_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_event_rsvps_pending_reminder;
    DROP INDEX IF EXISTS idx_event_rsvps_user;
    DROP TABLE IF EXISTS world_event_rsvps;
  `);
}
