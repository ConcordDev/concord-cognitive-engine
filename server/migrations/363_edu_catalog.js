// server/migrations/363_edu_catalog.js
//
// Durable, multi-tenant persistence for the education lens's courses /
// discussions / cohorts (domains/education.js — Khan Academy + Coursera
// parity). Previously all three lived in
// globalThis._concordSTATE.educationLens.{courses,discussions,cohorts}
// keyed as Map<userId, item[]> — every course was invisible to every OTHER
// user, so there was no shared catalog a learner could browse and enroll
// into (courses another user made simply never appeared in courses-list/
// courses-search for anyone else). Tracked as an open gap in
// docs/lens-specs/education-capability-map.md ("per-user Map keying") and
// docs/WAVE4_INVENTORY.md's `| education |` row.
//
// This migration flips the keying: one shared row per course/discussion/
// cohort with an `author_id` column, so any authenticated user can list/
// search/get/enroll-in any PUBLISHED course, while mutation (update/delete
// on a course) stays gated to `author_id === caller`. Discussions and
// cohorts are course-scoped forum/session objects — genuinely shared
// artifacts, not personal ones — so they move to the same shared-row shape
// (open-post/open-join, no per-post ownership gate beyond what the domain
// code already enforces).
//
// Persistence: reached via ctx.db using the same db-or-memory facade
// pattern as domains/tournaments.js (migration 360), domains/saved.js
// (migration 356), domains/ar.js (migration 332). When ctx.db is absent or
// these tables don't exist (minimal/test builds with no real server boot),
// the store falls back to a process-global (not per-user) in-memory Map —
// cross-user visibility holds either way; only cross-restart durability
// needs the DB path. The running server always has ctx.db, so the catalog
// survives a restart.
//
// Schema shape: mirrors migration 360's approach — scalar columns for
// filterable/sortable fields (author_id, course_id, category, status),
// JSON-blob columns for nested arrays that have no independent identity of
// their own outside their parent (a course's `lessons`, a cohort's
// `roster`). Lessons are NOT split into their own table: every existing
// lessons-* macro operates on the whole `course.lessons` array in one
// shot (append, find by id, mark complete elsewhere), so a normalized
// table would add a second query lookup on every course read for no
// functional benefit today. Kept honest per the tournaments-lens
// precedent's own comment on this exact tradeoff.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS edu_courses (
      id                 TEXT PRIMARY KEY,
      author_id          TEXT NOT NULL,
      title              TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      category           TEXT NOT NULL DEFAULT 'general',
      level              TEXT NOT NULL DEFAULT 'beginner',
        -- beginner | intermediate | advanced
      duration_hours     REAL NOT NULL DEFAULT 0,
      instructor         TEXT NOT NULL DEFAULT '',
      institution        TEXT NOT NULL DEFAULT '',
      kind               TEXT NOT NULL DEFAULT 'course',
        -- course | specialization | certificate | guided_project
      status             TEXT NOT NULL DEFAULT 'published',
        -- draft (author-only visibility) | published (catalog-visible to all)
      enrollment_count   INTEGER NOT NULL DEFAULT 0,
      rating             REAL NOT NULL DEFAULT 0,
      lessons_json       TEXT NOT NULL DEFAULT '[]',
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edu_courses_author ON edu_courses(author_id);
    CREATE INDEX IF NOT EXISTS idx_edu_courses_status_category ON edu_courses(status, category);

    CREATE TABLE IF NOT EXISTS edu_discussions (
      id                 TEXT PRIMARY KEY,
      course_id          TEXT NOT NULL,
      author_id          TEXT NOT NULL,
      text               TEXT NOT NULL,
      reply_to           TEXT,
      upvotes            INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edu_discussions_course ON edu_discussions(course_id);

    CREATE TABLE IF NOT EXISTS edu_cohorts (
      id                 TEXT PRIMARY KEY,
      course_id          TEXT,
      author_id          TEXT NOT NULL,
      title              TEXT NOT NULL,
      instructor         TEXT NOT NULL,
      scheduled_at       TEXT NOT NULL,
      duration_min       INTEGER NOT NULL DEFAULT 60,
      capacity           INTEGER NOT NULL DEFAULT 30,
      status             TEXT NOT NULL DEFAULT 'scheduled',
        -- scheduled | live | ended
      roster_json        TEXT NOT NULL DEFAULT '[]',
      agenda             TEXT NOT NULL DEFAULT '',
      started_at         TEXT,
      ended_at           TEXT,
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edu_cohorts_course ON edu_cohorts(course_id);
    CREATE INDEX IF NOT EXISTS idx_edu_cohorts_author ON edu_cohorts(author_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_edu_cohorts_author;
    DROP INDEX IF EXISTS idx_edu_cohorts_course;
    DROP TABLE IF EXISTS edu_cohorts;
    DROP INDEX IF EXISTS idx_edu_discussions_course;
    DROP TABLE IF EXISTS edu_discussions;
    DROP INDEX IF EXISTS idx_edu_courses_status_category;
    DROP INDEX IF EXISTS idx_edu_courses_author;
    DROP TABLE IF EXISTS edu_courses;
  `);
}
