// server/migrations/217_calendar.js
//
// Calendar lens Sprint A — real DB substrate.
//
// Replaces the localStorage-only / artifact-data approach with seven
// normalised tables: calendars (multi-calendar overlay) + events
// (with RRULE storage + parent-override semantics) + attendees with
// RSVP + reminders + event_overrides (instance edits to recurring
// events) + cross-app links + subscriptions (public iCal feed URLs).
//
// Designed for both the existing UI and the dead RFC-5545-compliant
// domains/calendar.js (~292 LOC) that will be promoted in this sprint
// alongside fixing the 8/8 smoking-gun streak.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendars (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'personal'
                    CHECK (kind IN ('personal','work','project','team','external','holiday','focus','tasks','world','huddle')),
      color         TEXT DEFAULT '#22d3ee',
      icon          TEXT,
      visibility    TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private','team','workspace','public')),
      source_uri    TEXT,                                -- external iCal subscription URL
      source_kind   TEXT,                                -- 'ical_subscription','google','apple','outlook','tasks','world','none'
      project_id    TEXT,                                -- when bridged to a project (Tasks lens)
      enabled       INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT,
      last_synced_at INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calendars_kind  ON calendars(kind, enabled);
    CREATE INDEX IF NOT EXISTS idx_calendars_proj  ON calendars(project_id) WHERE project_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id                  TEXT PRIMARY KEY,
      calendar_id         TEXT NOT NULL,
      organizer_id        TEXT NOT NULL,
      title               TEXT NOT NULL,
      description_html    TEXT,
      location            TEXT,
      start_at            INTEGER NOT NULL,             -- unix seconds
      end_at              INTEGER NOT NULL,
      all_day             INTEGER NOT NULL DEFAULT 0,
      timezone            TEXT,                          -- IANA TZ; null = floating
      status              TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK (status IN ('confirmed','tentative','cancelled')),
      visibility          TEXT NOT NULL DEFAULT 'default'
                          CHECK (visibility IN ('default','public','busy_only','private')),
      category            TEXT,
      color               TEXT,
      rrule               TEXT,                          -- RFC 5545 RRULE string (when recurring)
      recurring_parent_id TEXT,                          -- non-null = this is an override instance
      external_uid        TEXT,                          -- iCal UID for sync stability
      conferencing_url    TEXT,
      meta_json           TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at          INTEGER,
      FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_cal_range  ON calendar_events(calendar_id, start_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_events_organizer  ON calendar_events(organizer_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_events_recurring  ON calendar_events(recurring_parent_id) WHERE recurring_parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_events_external   ON calendar_events(external_uid) WHERE external_uid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_events_window     ON calendar_events(start_at, end_at) WHERE deleted_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_attendees (
      event_id      TEXT NOT NULL,
      user_id       TEXT,                                -- null for external invitees
      email         TEXT,
      name          TEXT,
      role          TEXT NOT NULL DEFAULT 'required'
                    CHECK (role IN ('organizer','required','optional','resource')),
      rsvp          TEXT NOT NULL DEFAULT 'needs_action'
                    CHECK (rsvp IN ('needs_action','accepted','declined','tentative')),
      responded_at  INTEGER,
      invited_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      invited_by    TEXT,
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attendees_event ON calendar_attendees(event_id);
    CREATE INDEX IF NOT EXISTS idx_attendees_user  ON calendar_attendees(user_id, rsvp) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendees_unique ON calendar_attendees(event_id, COALESCE(user_id, email));
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id        TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      minutes_before  INTEGER NOT NULL,
      method          TEXT NOT NULL DEFAULT 'push'
                      CHECK (method IN ('push','email','in_app')),
      fire_at         INTEGER,                            -- precomputed event.start_at - minutes_before*60
      fired_at        INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_event   ON calendar_reminders(event_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_pending ON calendar_reminders(user_id, fire_at) WHERE fired_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_event_overrides (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_event_id    TEXT NOT NULL,
      original_start_at  INTEGER NOT NULL,                -- which recurring instance to override
      status             TEXT NOT NULL CHECK (status IN ('cancelled','moved','modified')),
      new_start_at       INTEGER,
      new_end_at         INTEGER,
      new_title          TEXT,
      new_description_html TEXT,
      meta_json          TEXT,
      created_by         TEXT NOT NULL,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (parent_event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
      UNIQUE(parent_event_id, original_start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_overrides_parent ON calendar_event_overrides(parent_event_id, original_start_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id      TEXT NOT NULL,
      target_kind   TEXT NOT NULL
                    CHECK (target_kind IN ('task','doc','dtu','lens','external','project','sprint','world_event','huddle')),
      target_id     TEXT,
      target_uri    TEXT,
      target_label  TEXT,
      created_by    TEXT NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cal_links_event  ON calendar_links(event_id);
    CREATE INDEX IF NOT EXISTS idx_cal_links_target ON calendar_links(target_kind, target_id) WHERE target_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_subscriptions (
      id                 TEXT PRIMARY KEY,                -- public token for iCal feed URL
      owner_id           TEXT NOT NULL,
      calendar_ids_json  TEXT,                            -- JSON array of calendar ids; null = all of owner's
      visibility         TEXT NOT NULL DEFAULT 'busy_only'
                         CHECK (visibility IN ('busy_only','full')),
      active             INTEGER NOT NULL DEFAULT 1,
      last_accessed_at   INTEGER,
      access_count       INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_subs_owner ON calendar_subscriptions(owner_id, active);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS calendar_subscriptions;
    DROP TABLE IF EXISTS calendar_links;
    DROP TABLE IF EXISTS calendar_event_overrides;
    DROP TABLE IF EXISTS calendar_reminders;
    DROP TABLE IF EXISTS calendar_attendees;
    DROP TABLE IF EXISTS calendar_events;
    DROP TABLE IF EXISTS calendars;
  `);
}
