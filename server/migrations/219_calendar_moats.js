// server/migrations/219_calendar_moats.js
//
// Calendar Sprint C — concord-native moats.
//
// calendar_agents — calendar-bound agents publishable as agent_spec
// DTUs (mirrors doc_page_agents + task_project_agents pattern).
//
// calendar_event_mints — when an event is minted as event_spec DTU;
// royalty rate captured at mint time so cascade follows the agreed cut
// even if invariants evolve.
//
// calendar_booking_links — Calendly-style public booking URLs with
// available time windows + meeting duration + buffer + slug.
//
// calendar_booking_slots — confirmed bookings (one row per booking
// converted from a booking_link). Links to the actual calendar_event
// created on confirm.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_agents (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      calendar_id     TEXT,                            -- nullable for cross-calendar agents
      name            TEXT NOT NULL,
      description     TEXT,
      system_prompt   TEXT NOT NULL,
      capabilities_json TEXT,                          -- ["read_events","read_attendees","write_event","auto_schedule","reminder_compose"]
      slot            TEXT NOT NULL DEFAULT 'utility'
                      CHECK (slot IN ('conscious','subconscious','utility','repair','multimodal')),
      dtu_id          TEXT,                            -- set on publish
      active          INTEGER NOT NULL DEFAULT 1,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cal_agents_owner ON calendar_agents(owner_id, active);
    CREATE INDEX IF NOT EXISTS idx_cal_agents_dtu   ON calendar_agents(dtu_id) WHERE dtu_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_event_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id        TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'workspace'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_mints_creator ON calendar_event_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_booking_links (
      id                TEXT PRIMARY KEY,
      owner_id          TEXT NOT NULL,
      slug              TEXT NOT NULL UNIQUE,           -- public URL token /book/:slug
      title             TEXT NOT NULL,
      description       TEXT,
      duration_minutes  INTEGER NOT NULL DEFAULT 30,
      buffer_minutes    INTEGER NOT NULL DEFAULT 0,
      target_calendar_id TEXT NOT NULL,                  -- new bookings land here
      check_calendar_ids_json TEXT,                       -- which calendars to check for conflicts
      window_days_ahead INTEGER NOT NULL DEFAULT 14,
      work_start_hour   INTEGER NOT NULL DEFAULT 9,
      work_end_hour     INTEGER NOT NULL DEFAULT 17,
      include_weekends  INTEGER NOT NULL DEFAULT 0,
      conferencing_url  TEXT,
      max_per_day       INTEGER,
      active            INTEGER NOT NULL DEFAULT 1,
      booking_count     INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (target_calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_booking_links_owner ON calendar_booking_links(owner_id, active);
    CREATE INDEX IF NOT EXISTS idx_booking_links_slug ON calendar_booking_links(slug) WHERE active = 1;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_booking_slots (
      id              TEXT PRIMARY KEY,
      booking_link_id TEXT NOT NULL,
      event_id        TEXT NOT NULL,                    -- the created calendar_event
      guest_name      TEXT,
      guest_email     TEXT,
      message         TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (booking_link_id) REFERENCES calendar_booking_links(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_booking_slots_link ON calendar_booking_slots(booking_link_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS calendar_booking_slots;
    DROP TABLE IF EXISTS calendar_booking_links;
    DROP TABLE IF EXISTS calendar_event_mints;
    DROP TABLE IF EXISTS calendar_agents;
  `);
}
