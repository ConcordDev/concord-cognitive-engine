// server/migrations/165_classroom_research.js
//
// Phase 9.6 — classroom + cross-world physics + therapy fields
// + federation-of-deities + dtu-sync.
//
//   - classroom_cohorts: teacher + students + active assignment rubric
//   - homework_submissions: student DTU submissions per cohort
//   - peer_reviews: student-on-student feedback (cascade weighting)
//   - sub_worlds: Forge-app physics simulators spawned as worlds
//   - dtu_sync_devices: registered devices per user for cross-device
//     thought sync
//   - therapy_field_authors: therapist role + custom field authoring
//   - deity_pilgrimages: cross-instance pilgrim records

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS classroom_cohorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      teacher_user_id TEXT NOT NULL,
      rubric_dtu_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cohort_teacher ON classroom_cohorts(teacher_user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS classroom_enrolments (
      cohort_id INTEGER NOT NULL,
      student_user_id TEXT NOT NULL,
      enroled_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (cohort_id, student_user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS homework_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_id INTEGER NOT NULL,
      student_user_id TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      score INTEGER,
      submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      reviewed_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_homework_cohort ON homework_submissions(cohort_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_homework_student ON homework_submissions(student_user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      reviewer_user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(submission_id, reviewer_user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL UNIQUE,
      forge_app_dtu_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'physics_simulator',
      spawned_by_user_id TEXT NOT NULL,
      spawned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_sync_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      device_label TEXT NOT NULL,
      device_token TEXT NOT NULL UNIQUE,
      registered_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_synced_at INTEGER,
      auto_sync INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_devices_user ON dtu_sync_devices(user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS therapy_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      field_kind TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_therapy_target ON therapy_fields(target_user_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deity_pilgrimages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deity_id INTEGER NOT NULL,
      pilgrim_user_id TEXT NOT NULL,
      origin_peer TEXT,
      arrived_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pilgrim_deity ON deity_pilgrimages(deity_id)`);
}
