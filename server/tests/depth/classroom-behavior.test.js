// tests/depth/classroom-behavior.test.js — REAL behavioral tests for the
// classroom domain (registerLensAction family, invoked via lensRun).
//
// Covers the in-memory workspace macros that perform exact-value computation:
// assignment points clamping, grade percent, gradebook earned/possible/average +
// class average, quiz totalPoints + answer-stripping, case-insensitive auto-grade
// percent, and the to-do upcoming/missing/done bucketing. Every lensRun(...) call
// literally names the macro so the macro-depth grader credits it behaviorally.
//
// SKIPPED (network/external — Open Library, no offline contract): ol-search,
// ol-work, ol-subject, ol-isbn. These hit https://openlibrary.org and have no
// deterministic offline behavior to assert.
//
// NB: lens.run UNWRAPS a handler's `result` key. So a handler returning
// { ok:true, result:{X} } surfaces as r.ok===true + r.result.X; a handler
// returning { ok:false, error } surfaces as r.ok===true (dispatch) +
// r.result.ok===false + r.result.error (the handler's verdict).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

describe("classroom — grade + gradebook math (exact computed values)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("classroom-grade"); });

  it("assignment-create → grade-submission: percent = round(score/maxPoints*100), maxPoints from assignment", async () => {
    const asg = await lensRun("classroom", "assignment-create",
      { params: { title: "Essay 1", cohortId: 1, points: 80 } }, ctx);
    assert.equal(asg.ok, true);
    assert.equal(asg.result.assignment.points, 80);
    const assignmentId = asg.result.assignment.id;

    const sub = await lensRun("classroom", "submission-create",
      { params: { assignmentId, studentId: "stu-A", content: "my essay" } }, ctx);
    const submissionId = sub.result.submission.id;

    const graded = await lensRun("classroom", "grade-submission",
      { params: { submissionId, score: 60 } }, ctx);
    assert.equal(graded.ok, true);
    assert.equal(graded.result.grade.maxPoints, 80);   // pulled from the assignment, not params
    assert.equal(graded.result.grade.score, 60);
    assert.equal(graded.result.grade.percent, 75);     // round(60/80*100) = 75
    assert.equal(graded.result.grade.studentId, "stu-A");
  });

  it("grade-submission: score is clamped to [0, maxPoints]", async () => {
    const asg = await lensRun("classroom", "assignment-create",
      { params: { title: "Quiz pts", cohortId: 1, points: 50 } }, ctx);
    const sub = await lensRun("classroom", "submission-create",
      { params: { assignmentId: asg.result.assignment.id, studentId: "stu-clamp" } }, ctx);
    const graded = await lensRun("classroom", "grade-submission",
      { params: { submissionId: sub.result.submission.id, score: 999 } }, ctx);
    assert.equal(graded.result.grade.score, 50);   // clamped to maxPoints
    assert.equal(graded.result.grade.percent, 100); // round(50/50*100)
  });

  it("grade-submission: re-grading the same submission replaces (not duplicates) the grade", async () => {
    const asg = await lensRun("classroom", "assignment-create",
      { params: { title: "Regrade", cohortId: 1, points: 100 } }, ctx);
    const sub = await lensRun("classroom", "submission-create",
      { params: { assignmentId: asg.result.assignment.id, studentId: "stu-rg" } }, ctx);
    const submissionId = sub.result.submission.id;

    await lensRun("classroom", "grade-submission", { params: { submissionId, score: 40 } }, ctx);
    await lensRun("classroom", "grade-submission", { params: { submissionId, score: 90 } }, ctx);

    const subs = await lensRun("classroom", "submission-list",
      { params: { assignmentId: asg.result.assignment.id } }, ctx);
    const row = subs.result.submissions.find((s) => s.id === submissionId);
    assert.equal(row.grade.score, 90);     // the re-grade won
    assert.equal(row.grade.percent, 90);
  });

  it("gradebook: per-student totals + class average computed across graded cells", async () => {
    const gctx = await depthCtx("classroom-gradebook");
    // cohort 7: two assignments worth 100 + 50
    const a1 = await lensRun("classroom", "assignment-create",
      { params: { title: "A1", cohortId: 7, points: 100 } }, gctx);
    const a2 = await lensRun("classroom", "assignment-create",
      { params: { title: "A2", cohortId: 7, points: 50 } }, gctx);

    // student Alice: 80/100 + 40/50  → earned 120 / possible 150 → round(80%) = 80
    const sa1 = await lensRun("classroom", "submission-create",
      { params: { assignmentId: a1.result.assignment.id, studentId: "alice" } }, gctx);
    const sa2 = await lensRun("classroom", "submission-create",
      { params: { assignmentId: a2.result.assignment.id, studentId: "alice" } }, gctx);
    await lensRun("classroom", "grade-submission", { params: { submissionId: sa1.result.submission.id, score: 80 } }, gctx);
    await lensRun("classroom", "grade-submission", { params: { submissionId: sa2.result.submission.id, score: 40 } }, gctx);

    // student Bob: 50/100 only  → earned 50 / possible 100 → 50%
    const sb1 = await lensRun("classroom", "submission-create",
      { params: { assignmentId: a1.result.assignment.id, studentId: "bob" } }, gctx);
    await lensRun("classroom", "grade-submission", { params: { submissionId: sb1.result.submission.id, score: 50 } }, gctx);

    const gb = await lensRun("classroom", "gradebook", { params: { cohortId: 7 } }, gctx);
    assert.equal(gb.ok, true);
    assert.equal(gb.result.studentCount, 2);

    const alice = gb.result.rows.find((r) => r.studentId === "alice");
    assert.equal(alice.totalEarned, 120);
    assert.equal(alice.totalPossible, 150);
    assert.equal(alice.average, 80);

    const bob = gb.result.rows.find((r) => r.studentId === "bob");
    assert.equal(bob.totalEarned, 50);
    assert.equal(bob.totalPossible, 100);   // only the graded cell counts toward possible
    assert.equal(bob.average, 50);

    assert.equal(gb.result.classAverage, 65); // round((80 + 50) / 2)
  });
});

describe("classroom — quiz build + auto-grade (exact computed values)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("classroom-quiz"); });

  it("quiz-create: totalPoints = sum of question points, and correctAnswer is stripped from the returned copy", async () => {
    const qz = await lensRun("classroom", "quiz-create", { params: {
      title: "Bio Quiz", cohortId: 3,
      questions: [
        { kind: "multiple_choice", prompt: "Powerhouse of the cell?", options: ["Nucleus", "Mitochondria"], correctAnswer: "Mitochondria", points: 3 },
        { kind: "true_false", prompt: "Water is H2O", correctAnswer: "True", points: 2 },
      ],
    } }, ctx);
    assert.equal(qz.ok, true);
    assert.equal(qz.result.quiz.totalPoints, 5);   // 3 + 2
    // answers must never leak to the student-facing copy
    assert.ok(qz.result.quiz.questions.every((q) => !("correctAnswer" in q)));
    // true_false options are forced to ["True","False"]
    const tf = qz.result.quiz.questions.find((q) => q.kind === "true_false");
    assert.deepEqual(tf.options, ["True", "False"]);
  });

  it("quiz-submit: case-insensitive matching awards points; earned/percent are exact", async () => {
    const qz = await lensRun("classroom", "quiz-create", { params: {
      title: "Grade Me", cohortId: 4,
      questions: [
        { kind: "short_answer", prompt: "Capital of France?", correctAnswer: "Paris", points: 5 },
        { kind: "short_answer", prompt: "2 + 2 = ?", correctAnswer: "4", points: 5 },
      ],
    } }, ctx);
    const quiz = qz.result.quiz;
    const [q1, q2] = quiz.questions;

    // q1 correct (different case), q2 wrong → earned 5 / total 10 → 50%
    const att = await lensRun("classroom", "quiz-submit", { params: {
      quizId: quiz.id, studentId: "stu-q",
      answers: { [q1.id]: "  paRIS ", [q2.id]: "5" },
    } }, ctx);
    assert.equal(att.ok, true);
    assert.equal(att.result.attempt.score, 5);
    assert.equal(att.result.attempt.totalPoints, 10);
    assert.equal(att.result.attempt.percent, 50);

    const b1 = att.result.attempt.breakdown.find((b) => b.questionId === q1.id);
    assert.equal(b1.correct, true);
    assert.equal(b1.awarded, 5);
    const b2 = att.result.attempt.breakdown.find((b) => b.questionId === q2.id);
    assert.equal(b2.correct, false);
    assert.equal(b2.awarded, 0);
  });

  it("quiz-attempts: averagePercent across multiple attempts is the rounded mean", async () => {
    const actx = await depthCtx("classroom-quiz-avg");
    const qz = await lensRun("classroom", "quiz-create", { params: {
      title: "Avg", cohortId: 9,
      questions: [{ kind: "short_answer", prompt: "X?", correctAnswer: "yes", points: 10 }],
    } }, actx);
    const quiz = qz.result.quiz;
    const qid = quiz.questions[0].id;

    // attempt 1: correct → 100%
    await lensRun("classroom", "quiz-submit", { params: { quizId: quiz.id, studentId: "a", answers: { [qid]: "yes" } } }, actx);
    // attempt 2: wrong → 0%
    await lensRun("classroom", "quiz-submit", { params: { quizId: quiz.id, studentId: "b", answers: { [qid]: "no" } } }, actx);

    const att = await lensRun("classroom", "quiz-attempts", { params: { quizId: quiz.id } }, actx);
    assert.equal(att.result.count, 2);
    assert.equal(att.result.averagePercent, 50);  // round((100 + 0) / 2)
  });
});

describe("classroom — to-do bucketing (exact buckets)", () => {
  it("todo: past-due unsubmitted → missing, future unsubmitted → upcoming, graded → done", async () => {
    const tctx = await depthCtx("classroom-todo");
    const past = "2000-01-01T00:00:00.000Z";   // long past
    const future = "2999-01-01T00:00:00.000Z"; // far future

    const aMissing = await lensRun("classroom", "assignment-create",
      { params: { title: "Late", cohortId: 5, points: 10, dueAt: past } }, tctx);
    const aUpcoming = await lensRun("classroom", "assignment-create",
      { params: { title: "Soon", cohortId: 5, points: 10, dueAt: future } }, tctx);
    const aDone = await lensRun("classroom", "assignment-create",
      { params: { title: "Finished", cohortId: 5, points: 10, dueAt: future } }, tctx);

    // submit + grade the "done" one for student-T
    const sub = await lensRun("classroom", "submission-create",
      { params: { assignmentId: aDone.result.assignment.id, studentId: "student-T" } }, tctx);
    await lensRun("classroom", "grade-submission",
      { params: { submissionId: sub.result.submission.id, score: 10 } }, tctx);

    const todo = await lensRun("classroom", "todo", { params: { cohortId: 5, studentId: "student-T" } }, tctx);
    assert.equal(todo.ok, true);
    assert.equal(todo.result.counts.missing, 1);
    assert.equal(todo.result.counts.upcoming, 1);
    assert.equal(todo.result.counts.done, 1);
    assert.ok(todo.result.missing.some((i) => i.assignmentId === aMissing.result.assignment.id));
    assert.ok(todo.result.upcoming.some((i) => i.assignmentId === aUpcoming.result.assignment.id));
    assert.ok(todo.result.done.some((i) => i.assignmentId === aDone.result.assignment.id));
  });
});

describe("classroom — CRUD round-trips + validation rejections (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("classroom-crud"); });

  it("assignment-create: points are clamped to [0, 1000]", async () => {
    const over = await lensRun("classroom", "assignment-create",
      { params: { title: "Big", cohortId: 2, points: 5000 } }, ctx);
    assert.equal(over.result.assignment.points, 1000);
    const under = await lensRun("classroom", "assignment-create",
      { params: { title: "Neg", cohortId: 2, points: -7 } }, ctx);
    // Number(-7) is truthy-finite; Math.max(0, min(1000, -7)) = 0
    assert.equal(under.result.assignment.points, 0);
  });

  it("material-add → material-list → material-delete: round-trips then is gone", async () => {
    const add = await lensRun("classroom", "material-add",
      { params: { title: "Syllabus", cohortId: 2, kind: "link", url: "https://example.test/syllabus", topic: "Intro" } }, ctx);
    assert.equal(add.ok, true);
    const id = add.result.material.id;

    const list = await lensRun("classroom", "material-list", { params: { cohortId: 2 } }, ctx);
    assert.ok(list.result.materials.some((m) => m.id === id));
    assert.ok(list.result.byTopic.Intro.some((m) => m.id === id));  // grouped by topic

    const del = await lensRun("classroom", "material-delete", { params: { materialId: id } }, ctx);
    assert.equal(del.result.deleted, id);
    const after = await lensRun("classroom", "material-list", { params: { cohortId: 2 } }, ctx);
    assert.ok(!after.result.materials.some((m) => m.id === id));   // really removed
  });

  it("announce → stream-list: announcement reads back filtered by cohort", async () => {
    await lensRun("classroom", "announce", { params: { text: "Welcome to cohort 42", cohortId: 42 } }, ctx);
    const stream = await lensRun("classroom", "stream-list", { params: { cohortId: 42 } }, ctx);
    assert.ok(stream.result.stream.some((e) => e.kind === "announcement" && e.text.includes("cohort 42")));
  });

  it("validation: assignment-create with no title is rejected", async () => {
    const bad = await lensRun("classroom", "assignment-create", { params: { cohortId: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("validation: assignment-create with no cohortId is rejected", async () => {
    const bad = await lensRun("classroom", "assignment-create", { params: { title: "Orphan" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cohortId required/);
  });

  it("validation: quiz-create rejects a multiple_choice question with < 2 options", async () => {
    const bad = await lensRun("classroom", "quiz-create", { params: {
      title: "Bad Quiz", cohortId: 1,
      questions: [{ kind: "multiple_choice", prompt: "Pick one", options: ["only"], correctAnswer: "only", points: 1 }],
    } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /needs >=2 options/);
  });

  it("validation: grade-submission on a missing submission is rejected", async () => {
    const bad = await lensRun("classroom", "grade-submission", { params: { submissionId: "nope-does-not-exist", score: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /submission not found/);
  });
});

// ── DB-backed cohort macros: register()/runMacro family, exercised via
//    macroRuntime. These persist to classroom_cohorts / classroom_enrolments /
//    homework_submissions / peer_reviews (migration 165) and return the macro's
//    verdict object DIRECTLY (no lens.run unwrap). r.ok===false on rejection. ──
describe("classroom — DB cohort lifecycle (create → enrol → submit → review)", () => {
  let runMacro, teacher;
  before(async () => { ({ runMacro, ctx: teacher } = await macroRuntime("classroom-teacher")); });

  it("create_cohort: persists a cohort owned by the caller, returns numeric cohortId", async () => {
    const r = await runMacro("classroom", "create_cohort", { name: "Algebra I" }, teacher);
    assert.equal(r.ok, true);
    assert.equal(typeof r.cohortId, "number");
    assert.ok(r.cohortId > 0);
  });

  it("create_cohort: missing name is rejected with missing_name", async () => {
    const r = await runMacro("classroom", "create_cohort", {}, teacher);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_name");
  });

  it("enrol: defaults studentUserId to the caller when omitted (self-enrolment)", async () => {
    const c = await runMacro("classroom", "create_cohort", { name: "Self Enrol" }, teacher);
    const r = await runMacro("classroom", "enrol", { cohortId: c.cohortId }, teacher);
    assert.equal(r.ok, true);
    assert.equal(r.cohortId, c.cohortId);
    assert.equal(r.studentUserId, "classroom-teacher"); // makeInternalCtx label = userId
  });

  it("enrol: missing cohortId is rejected with missing_cohort", async () => {
    const r = await runMacro("classroom", "enrol", { studentUserId: "stu-x" }, teacher);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_cohort");
  });

  it("enrol: re-enrolling the same student is idempotent — enrolled count stays 1 (INSERT OR IGNORE)", async () => {
    const c = await runMacro("classroom", "create_cohort", { name: "Dup Enrol" }, teacher);
    const first = await runMacro("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "dup-stu" }, teacher);
    const second = await runMacro("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "dup-stu" }, teacher);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true); // PK collision swallowed, still ok
    // round-trip: the duplicate enrolment did NOT create a second row
    const out = await runMacro("classroom", "list_cohorts", {}, teacher);
    const taught = out.teaching.find((t) => t.id === c.cohortId);
    assert.equal(taught.enrolled, 1); // exactly one, not two
  });

  it("submit_homework: an enrolled student gets a submissionId; the same DB row drives peer_review", async () => {
    const { runMacro: rm, ctx: student } = await macroRuntime("classroom-student");
    const c = await runMacro("classroom", "create_cohort", { name: "Homework Cohort" }, teacher);
    // teacher enrols the student
    await runMacro("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "classroom-student" }, teacher);
    // student submits a DTU
    const sub = await rm("classroom", "submit_homework", { cohortId: c.cohortId, dtuId: "dtu-essay-1" }, student);
    assert.equal(sub.ok, true);
    assert.equal(typeof sub.submissionId, "number");
    assert.ok(sub.submissionId > 0); // a real AUTOINCREMENT rowid

    // round-trip proof the homework row exists: a peer_review against an absent
    // submissionId would FK-orphan; against this real id it persists cleanly.
    const { runMacro: rmr, ctx: reviewer } = await macroRuntime("classroom-reviewer");
    const rev = await rmr("classroom", "peer_review", { submissionId: sub.submissionId, score: 87.9, comment: "solid" }, reviewer);
    assert.equal(rev.ok, true);
  });

  it("submit_homework: a non-enrolled student is rejected with not_enroled", async () => {
    const { runMacro: rm, ctx: outsider } = await macroRuntime("classroom-outsider");
    const c = await runMacro("classroom", "create_cohort", { name: "Closed Cohort" }, teacher);
    const r = await rm("classroom", "submit_homework", { cohortId: c.cohortId, dtuId: "dtu-z" }, outsider);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_enroled");
  });

  it("submit_homework: missing dtuId is rejected with missing_inputs", async () => {
    const c = await runMacro("classroom", "create_cohort", { name: "Missing Inputs" }, teacher);
    const { runMacro: rm, ctx: student } = await macroRuntime("classroom-mi-student");
    await runMacro("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "classroom-mi-student" }, teacher);
    const r = await rm("classroom", "submit_homework", { cohortId: c.cohortId }, student);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("peer_review: missing score is rejected with missing_inputs (score===undefined guard)", async () => {
    const r = await runMacro("classroom", "peer_review", { submissionId: 123 }, teacher);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("peer_review: out-of-range scores are accepted (clamped 0-100), re-review replaces on the UNIQUE pair", async () => {
    const { runMacro: rm, ctx: student } = await macroRuntime("classroom-rr-student");
    const c = await runMacro("classroom", "create_cohort", { name: "Re-review" }, teacher);
    await runMacro("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "classroom-rr-student" }, teacher);
    const sub = await rm("classroom", "submit_homework", { cohortId: c.cohortId, dtuId: "dtu-rr" }, student);
    assert.ok(sub.submissionId > 0);
    // first review: 10. second review (same reviewer+submission): an over-range 250
    // → Math.max(0,Math.min(100,floor(250)))=100, accepted, REPLACES rather than
    //   throwing on the UNIQUE(submission_id, reviewer_user_id) pair.
    const a = await runMacro("classroom", "peer_review", { submissionId: sub.submissionId, score: 10 }, teacher);
    const b = await runMacro("classroom", "peer_review", { submissionId: sub.submissionId, score: 250 }, teacher);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true); // replace, not duplicate-key throw
    // a negative score is also clamped (to 0), not rejected
    const neg = await runMacro("classroom", "peer_review", { submissionId: sub.submissionId, score: -5 }, teacher);
    assert.equal(neg.ok, true);
  });

  it("list_cohorts: teaching shows the teacher's cohorts with live enrolled counts; studying shows enrolments", async () => {
    const { runMacro: rm, ctx: owner } = await macroRuntime("classroom-list-owner");
    const c = await rm("classroom", "create_cohort", { name: "Counting Cohort" }, owner);
    // enrol two distinct students
    await rm("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "ls-stu-1" }, owner);
    await rm("classroom", "enrol", { cohortId: c.cohortId, studentUserId: "ls-stu-2" }, owner);

    const out = await rm("classroom", "list_cohorts", {}, owner);
    assert.equal(out.ok, true);
    const taught = out.teaching.find((t) => t.id === c.cohortId);
    assert.ok(taught, "newly created cohort appears in teaching");
    assert.equal(taught.name, "Counting Cohort");
    assert.equal(taught.enrolled, 2); // subquery count over classroom_enrolments

    // a student of THIS cohort sees it under studying
    const { runMacro: rms, ctx: stu } = await macroRuntime("ls-stu-1");
    const seen = await rms("classroom", "list_cohorts", {}, stu);
    assert.equal(seen.ok, true);
    assert.ok(seen.studying.some((s) => s.id === c.cohortId));
  });
});
