// Education becomes the Reading Room: courses anyone can publish (free or
// sold in Concord Coin) and anyone can take, with real lessons (a reading, a
// video, a graded check), completion that has to be earned, and
// certificates anyone can verify.
//
// edu_courses gains extra_json for the course page (price, summary, what
// you'll learn, pass mark, published time, the sale DTU). Enrollment,
// per-lesson progress, check attempts, purchases, reviews, certificates and discussion votes
// get tables of their own so a creator can see their learners and a
// certificate outlives any in-memory state.

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

export function up(db) {
  const have = cols(db, "edu_courses");
  if (have.length && !have.includes("extra_json")) db.exec("ALTER TABLE edu_courses ADD COLUMN extra_json TEXT");

  // A course's discussion doubles as each lesson's Q&A: a question is a post
  // tagged with its lesson (and, for a video, the moment it was asked at);
  // the asker can mark one reply as the answer.
  const disc = cols(db, "edu_discussions");
  if (disc.length) {
    if (!disc.includes("lesson_id")) db.exec("ALTER TABLE edu_discussions ADD COLUMN lesson_id TEXT");
    if (!disc.includes("timestamp_sec")) db.exec("ALTER TABLE edu_discussions ADD COLUMN timestamp_sec REAL");
    if (!disc.includes("accepted_id")) db.exec("ALTER TABLE edu_discussions ADD COLUMN accepted_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_edu_discussions_lesson ON edu_discussions(course_id, lesson_id)");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS edu_enrollments (
      course_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      enrolled_at INTEGER NOT NULL DEFAULT (unixepoch()),
      paid_cc     REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (course_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_edu_enrollments_user ON edu_enrollments(user_id);

    CREATE TABLE IF NOT EXISTS edu_lesson_progress (
      course_id    TEXT NOT NULL,
      lesson_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      opened_at    INTEGER,
      completed_at INTEGER,
      best_score   REAL,
      PRIMARY KEY (course_id, lesson_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_edu_progress_user ON edu_lesson_progress(user_id, course_id);

    CREATE TABLE IF NOT EXISTS edu_check_attempts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   TEXT NOT NULL,
      lesson_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      score       REAL NOT NULL,
      passed      INTEGER NOT NULL,
      answers_json TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_edu_attempts ON edu_check_attempts(course_id, lesson_id);

    CREATE TABLE IF NOT EXISTS edu_reviews (
      course_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      stars      INTEGER NOT NULL,
      text       TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (course_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS edu_certificates (
      code         TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      course_id    TEXT NOT NULL,
      course_title TEXT NOT NULL,
      creator_id   TEXT NOT NULL,
      lessons      INTEGER NOT NULL,
      avg_score    REAL,
      issued_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edu_cert_user_course ON edu_certificates(user_id, course_id);

    CREATE TABLE IF NOT EXISTS edu_discussion_votes (
      post_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (post_id, user_id)
    );
  `);
}

export function down() {
  // Additive; nothing to undo safely.
}
