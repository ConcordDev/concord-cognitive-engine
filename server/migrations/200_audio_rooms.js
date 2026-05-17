// server/migrations/200_audio_rooms.js
//
// Phase 11 (Item 7) — live audio rooms (Spaces).
//
// Three tables:
//
//   audio_rooms — room metadata. host_user_id; title; started_at /
//                 ended_at; optional recording_url (recording is
//                 opt-in by the host, written to artifact storage,
//                 never auto-recorded).
//
//   audio_room_speakers — who's mic'd up. role = host | speaker |
//                         co-host. joined_at / left_at for session
//                         tracking. UNIQUE on (room, user) so a
//                         single user can't be in twice.
//
//   audio_room_listeners — silent attendees. hand_raised_at is set
//                          when the user requests to speak; cleared
//                          when promoted or denied. UNIQUE on
//                          (room, user) for the same reason.
//
// Honest discipline: listener counts are real Socket.io room sizes,
// never fabricated. Recordings require explicit host opt-in.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_rooms (
      id              TEXT PRIMARY KEY,
      host_user_id    TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      max_listeners   INTEGER NOT NULL DEFAULT 200,
      recording_url   TEXT,
      is_recording    INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audio_rooms_active ON audio_rooms(ended_at, started_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audio_rooms_host   ON audio_rooms(host_user_id, started_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_room_speakers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id         TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      role            TEXT NOT NULL CHECK (role IN ('host', 'co-host', 'speaker')),
      joined_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at         INTEGER,
      UNIQUE (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES audio_rooms(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audio_room_speakers_room ON audio_room_speakers(room_id, role)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_room_listeners (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id           TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      joined_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at           INTEGER,
      hand_raised_at    INTEGER,
      UNIQUE (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES audio_rooms(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audio_room_listeners_room ON audio_room_listeners(room_id, left_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_audio_room_listeners_room`);
  db.exec(`DROP TABLE IF EXISTS audio_room_listeners`);
  db.exec(`DROP INDEX IF EXISTS idx_audio_room_speakers_room`);
  db.exec(`DROP TABLE IF EXISTS audio_room_speakers`);
  db.exec(`DROP INDEX IF EXISTS idx_audio_rooms_host`);
  db.exec(`DROP INDEX IF EXISTS idx_audio_rooms_active`);
  db.exec(`DROP TABLE IF EXISTS audio_rooms`);
}
