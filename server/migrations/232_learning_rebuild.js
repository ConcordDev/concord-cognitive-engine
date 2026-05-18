// server/migrations/232_learning_rebuild.js
//
// Smoking-gun cleanup C1 — Education lens rebuild (~20 endpoint 404s).
// The lens page calls /api/learning/* endpoints that don't exist on
// the server. These tables back the new routes.

export function up(db) {
  // Cohorts (study groups) ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_cohorts (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT,
      topic           TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'study'
                      CHECK (kind IN ('study','teach','research','tutor')),
      teacher_user_id TEXT,                                -- null when peer-led
      max_size        INTEGER NOT NULL DEFAULT 12,
      current_size    INTEGER NOT NULL DEFAULT 0,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public')),
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lcohort_topic    ON learning_cohorts(topic, kind, created_at DESC) WHERE closed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_lcohort_creator  ON learning_cohorts(created_by, created_at DESC);

    CREATE TABLE IF NOT EXISTS learning_cohort_members (
      cohort_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'student'
                  CHECK (role IN ('student','teacher','assistant','observer')),
      joined_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at     INTEGER,
      PRIMARY KEY (cohort_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lcm_user ON learning_cohort_members(user_id, joined_at DESC) WHERE left_at IS NULL;
  `);

  // Assessments + Submissions ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_assessments (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      topic           TEXT NOT NULL,
      difficulty      TEXT NOT NULL DEFAULT 'medium'
                      CHECK (difficulty IN ('easy','medium','hard','expert')),
      kind            TEXT NOT NULL DEFAULT 'quiz'
                      CHECK (kind IN ('quiz','exam','project','reflection','oral')),
      questions_json  TEXT NOT NULL,                       -- array of {q, kind, choices?, correct?, points}
      total_points    INTEGER NOT NULL DEFAULT 100,
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_lassess_topic ON learning_assessments(topic, difficulty);

    CREATE TABLE IF NOT EXISTS learning_submissions (
      id              TEXT PRIMARY KEY,
      assessment_id   TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      cohort_id       TEXT,
      answers_json    TEXT NOT NULL,
      score           REAL,                                -- 0-100, null until graded
      grade_letter    TEXT,                                -- A/B/C/D/F or null
      feedback        TEXT,
      submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      graded_at       INTEGER,
      FOREIGN KEY (assessment_id) REFERENCES learning_assessments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lsub_student ON learning_submissions(student_user_id, submitted_at DESC);
  `);

  // Credentials (badges + verified achievements) ─────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_credentials (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      kind            TEXT NOT NULL                        -- 'badge', 'certificate', 'mastery', 'reputation'
                      CHECK (kind IN ('badge','certificate','mastery','reputation')),
      title           TEXT NOT NULL,
      topic           TEXT,
      issued_by       TEXT NOT NULL,                       -- user_id of issuer (could be 'system')
      evidence_json   TEXT,                                -- {assessmentIds, submissionIds, dtuIds}
      score           REAL,
      issued_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER,                             -- null = forever
      revoked_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lcred_user ON learning_credentials(user_id, issued_at DESC) WHERE revoked_at IS NULL;
  `);

  // Learning paths (curriculum sequences) ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_paths (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      topic           TEXT NOT NULL,
      description     TEXT,
      level           TEXT NOT NULL DEFAULT 'beginner'
                      CHECK (level IN ('beginner','intermediate','advanced','expert')),
      author_user_id  TEXT NOT NULL,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published')),
      step_count      INTEGER NOT NULL DEFAULT 0,
      enrolled_count  INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_lpath_topic ON learning_paths(topic, level);

    CREATE TABLE IF NOT EXISTS learning_path_steps (
      path_id     TEXT NOT NULL,
      step_index  INTEGER NOT NULL,
      title       TEXT NOT NULL,
      kind        TEXT NOT NULL                            -- 'read','watch','do','reflect','assess'
                  CHECK (kind IN ('read','watch','do','reflect','assess')),
      dtu_id      TEXT,                                    -- linked DTU if any
      duration_min INTEGER,
      PRIMARY KEY (path_id, step_index),
      FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS learning_path_enrollments (
      path_id        TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      current_step   INTEGER NOT NULL DEFAULT 0,
      completed_at   INTEGER,
      enrolled_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (path_id, user_id),
      FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lpe_user ON learning_path_enrollments(user_id);
  `);

  // Interactions (clicks/views/asks — learner journey log) ────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_interactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      kind            TEXT NOT NULL                        -- 'dtu_view','dtu_cite','question_ask','tutor_msg','path_advance'
                      CHECK (kind IN ('dtu_view','dtu_cite','question_ask','tutor_msg','path_advance','assessment_complete')),
      subject_id      TEXT,
      meta_json       TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_linter_user ON learning_interactions(user_id, created_at DESC);
  `);

  // Tutor sessions (AI tutor + Socratic) ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_tutor_sessions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'ask'
                      CHECK (kind IN ('ask','socratic','expert_walkthrough')),
      topic           TEXT,
      messages_json   TEXT NOT NULL DEFAULT '[]',          -- [{role, content, at}, ...]
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lts_user ON learning_tutor_sessions(user_id, started_at DESC);
  `);

  // Earnings — creator/tutor royalties from cohort + tutor work ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_earnings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      source          TEXT NOT NULL                        -- 'cohort_teach','tutor_session','assessment_grade','path_authorship','citation_royalty'
                      CHECK (source IN ('cohort_teach','tutor_session','assessment_grade','path_authorship','citation_royalty')),
      amount          REAL NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      ref_id          TEXT,                                -- session/cohort/path id
      earned_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_learn_earn ON learning_earnings(user_id, earned_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS learning_earnings;
    DROP TABLE IF EXISTS learning_tutor_sessions;
    DROP TABLE IF EXISTS learning_interactions;
    DROP TABLE IF EXISTS learning_path_enrollments;
    DROP TABLE IF EXISTS learning_path_steps;
    DROP TABLE IF EXISTS learning_paths;
    DROP TABLE IF EXISTS learning_credentials;
    DROP TABLE IF EXISTS learning_submissions;
    DROP TABLE IF EXISTS learning_assessments;
    DROP TABLE IF EXISTS learning_cohort_members;
    DROP TABLE IF EXISTS learning_cohorts;
  `);
}
