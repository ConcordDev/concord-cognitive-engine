// server/tests/education-catalog-persistence.test.js
//
// DB-backed persistence tests for server/domains/education.js's multi-
// tenant catalog (migration 363 — edu_courses / edu_discussions /
// edu_cohorts). The sibling education-domain-parity.test.js and
// education-lens-macros.test.js files drive the domain against the
// in-memory globalThis._concordSTATE.educationLens fallback (no ctx.db).
// This file pins the DURABLE path: it hands each macro a real migrated
// better-sqlite3 DB via ctx.db and proves:
//   - real persistence — the row lands in edu_courses/edu_discussions/
//     edu_cohorts themselves (checked via a raw db.prepare(...).get(id)
//     query, NOT just the macro's own `get` handler)
//   - restart-equivalence — a SECOND, independent better-sqlite3 handle
//     opened against the same file sees the same rows (not a process-
//     global Map)
//   - cross-user visibility in the DB path specifically: a course
//     authored by one user shows up for a completely different caller
//   - ownership-gated mutation in the DB path: a non-author's
//     update/delete is rejected and the row is provably unchanged on disk

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerEducationActions from "../domains/education.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
// Mirror the real LENS_ACTIONS 3-arg dispatch: handler(ctx, artifact, params).
function call(db, userId, name, params = {}) {
  const fn = ACTIONS.get(`education.${name}`);
  if (!fn) throw new Error(`education.${name} not registered`);
  const ctx = { db, actor: { userId }, userId };
  return fn(ctx, { id: null, data: {}, meta: {} }, params || {});
}

let db;
let dbFile;
beforeEach(async () => {
  ACTIONS.clear();
  registerEducationActions(register);
  // A FILE-backed DB so a second independent handle can prove restart durability.
  dbFile = path.join(os.tmpdir(), `edu-catalog-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbFile);
  await runMigrations(db);
  // Keep the in-memory fallback empty so we can be sure the DB path is exercised.
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("education catalog — DB persistence (durable, restart-equivalent)", () => {
  it("persists a created course into edu_courses, not a process Map", () => {
    const c = call(db, "authorA", "courses-create", { title: "Durable Course", category: "math" });
    assert.equal(c.ok, true, c.error);
    const id = c.result.course.id;

    // The load-bearing proof: query the RAW SQL table directly, not through
    // the macro's own `get` handler.
    const row = db.prepare("SELECT * FROM edu_courses WHERE id = ?").get(id);
    assert.ok(row, "course row must exist on disk in edu_courses");
    assert.equal(row.author_id, "authorA");
    assert.equal(row.title, "Durable Course");
    assert.equal(row.category, "math");
    assert.equal(row.status, "published");
    assert.deepEqual(JSON.parse(row.lessons_json), []);

    // The process-global in-memory fallback's course Map must stay EMPTY —
    // getEduState() eagerly initializes the lens's Maps as a STATE-
    // availability guard (unlike tournaments.js's lazy getMemState()), so
    // asserting `educationLens === undefined` doesn't fit here; asserting
    // the mem Map has zero entries is the equivalent proof that the DB
    // path, not the Map fallback, actually holds this course.
    assert.equal(globalThis._concordSTATE.educationLens.courses.size, 0);
  });

  it("survives a brand-new independent DB handle to the same file (restart-equivalence)", () => {
    const c = call(db, "authorA", "courses-create", { title: "Restart Course" });
    const id = c.result.course.id;
    call(db, "authorA", "lessons-create", { courseId: id, title: "Lesson 1" });
    call(db, "authorA", "lessons-create", { courseId: id, title: "Lesson 2" });

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare("SELECT * FROM edu_courses WHERE id = ?").get(id);
      assert.ok(row, "row must be visible from a second, independent handle");
      const lessons = JSON.parse(row.lessons_json);
      assert.equal(lessons.length, 2);
      assert.deepEqual(lessons.map((l) => l.title), ["Lesson 1", "Lesson 2"]);
    } finally { db2.close(); }
  });

  it("cross-user visibility: a course authored by A is listed and gettable by B through the DB path", () => {
    const c = call(db, "authorA", "courses-create", { title: "Shared via DB", category: "cs" });
    const id = c.result.course.id;

    const listedByB = call(db, "userB", "courses-list", {});
    assert.ok(listedByB.result.courses.some((x) => x.id === id));

    const gotByB = call(db, "userB", "courses-get", { id });
    assert.equal(gotByB.ok, true);
    assert.equal(gotByB.result.course.title, "Shared via DB");

    // Raw SQL confirms there is exactly ONE row (not one-per-user duplication).
    const rows = db.prepare("SELECT COUNT(*) AS n FROM edu_courses WHERE id = ?").get(id);
    assert.equal(rows.n, 1);
  });

  it("ownership-gated mutation in the DB path: non-author update/delete rejected; row provably unchanged on disk", () => {
    const c = call(db, "authorA", "courses-create", { title: "Protected Course" });
    const id = c.result.course.id;

    const badDelete = call(db, "userB", "courses-delete", { id });
    assert.equal(badDelete.ok, false);
    assert.match(badDelete.error, /not authorized/);
    assert.ok(db.prepare("SELECT id FROM edu_courses WHERE id = ?").get(id), "row must still exist after a rejected non-author delete");

    const badUpdate = call(db, "userB", "courses-update", { id, title: "Hijacked" });
    assert.equal(badUpdate.ok, false);
    assert.match(badUpdate.error, /not authorized/);
    const rowAfterBadUpdate = db.prepare("SELECT title FROM edu_courses WHERE id = ?").get(id);
    assert.equal(rowAfterBadUpdate.title, "Protected Course", "title must be untouched by a rejected non-author update");

    // The real author's own mutation succeeds and lands in the DB.
    const goodUpdate = call(db, "authorA", "courses-update", { id, title: "Renamed By Owner" });
    assert.equal(goodUpdate.ok, true);
    const rowAfterGoodUpdate = db.prepare("SELECT title FROM edu_courses WHERE id = ?").get(id);
    assert.equal(rowAfterGoodUpdate.title, "Renamed By Owner");

    const goodDelete = call(db, "authorA", "courses-delete", { id });
    assert.equal(goodDelete.ok, true);
    assert.equal(db.prepare("SELECT id FROM edu_courses WHERE id = ?").get(id), undefined, "row must be gone after the real author deletes it");
  });

  it("discussions persist into edu_discussions and are visible across users through the DB path", () => {
    const course = call(db, "authorA", "courses-create", { title: "Discussed Course" });
    const courseId = course.result.course.id;
    const p1 = call(db, "authorA", "discussions-post", { courseId, text: "question from A" });
    assert.equal(p1.ok, true);
    const p2 = call(db, "userB", "discussions-post", { courseId, text: "reply from B" });
    assert.equal(p2.ok, true);

    const rows = db.prepare("SELECT * FROM edu_discussions WHERE course_id = ? ORDER BY rowid ASC").all(courseId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].author_id, "authorA");
    assert.equal(rows[1].author_id, "userB");

    // Listed by a THIRD user — sees both posts (open forum, cross-user).
    const listedByC = call(db, "userC", "discussions-list", { courseId });
    assert.equal(listedByC.result.discussions.length, 2);

    const up = call(db, "userC", "discussions-upvote", { id: p1.result.post.id });
    assert.equal(up.ok, true);
    assert.equal(up.result.upvotes, 1);
    const rowAfterUpvote = db.prepare("SELECT upvotes FROM edu_discussions WHERE id = ?").get(p1.result.post.id);
    assert.equal(rowAfterUpvote.upvotes, 1);
  });

  it("cohorts persist into edu_cohorts; join/leave from a different user land in the roster_json column", () => {
    const c = call(db, "instructorA", "cohorts-create", { title: "Live Session", instructor: "Dr A", capacity: 5 });
    assert.equal(c.ok, true);
    const id = c.result.cohort.id;

    const join = call(db, "learnerB", "cohorts-join", { id, learner: "learnerB" });
    assert.equal(join.ok, true);

    const row = db.prepare("SELECT roster_json, author_id FROM edu_cohorts WHERE id = ?").get(id);
    assert.equal(row.author_id, "instructorA");
    assert.deepEqual(JSON.parse(row.roster_json), ["learnerB"]);

    // A non-author cannot transition the cohort's status.
    const badStatus = call(db, "learnerB", "cohorts-set-status", { id, status: "live" });
    assert.equal(badStatus.ok, false);
    assert.match(badStatus.error, /not authorized/);

    // The scheduling author can.
    const goodStatus = call(db, "instructorA", "cohorts-set-status", { id, status: "live" });
    assert.equal(goodStatus.ok, true);
    const rowAfter = db.prepare("SELECT status FROM edu_cohorts WHERE id = ?").get(id);
    assert.equal(rowAfter.status, "live");
  });
});
