// Contract tests for server/domains/classroom.js workspace macros —
// assignments, gradebook, stream, materials, to-do, and auto-graded
// quizzes. Open Library REST macros are smoke-checked for bad input.
//
// Persistent workspace state lives in globalThis._concordSTATE Maps; the
// test installs a fresh STATE before each run so cases don't bleed.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerClassroomActions from "../domains/classroom.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`classroom.${name}`);
  if (!fn) throw new Error(`classroom.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerClassroomActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctx = { actor: { userId: "teacher_1" }, userId: "teacher_1" };

describe("classroom assignments", () => {
  it("creates an assignment with points + due date", () => {
    const r = call("assignment-create", ctx, {
      cohortId: 7, title: "Essay 1", instructions: "Write 500 words",
      dueAt: "2026-06-01T12:00:00Z", points: 50, topic: "Writing",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.assignment.title, "Essay 1");
    assert.equal(r.result.assignment.points, 50);
    assert.equal(r.result.assignment.cohortId, 7);
  });

  it("rejects assignment without title", () => {
    const r = call("assignment-create", ctx, { cohortId: 7 });
    assert.equal(r.ok, false);
  });

  it("lists assignments filtered by cohort with submission counts", () => {
    call("assignment-create", ctx, { cohortId: 1, title: "A" });
    call("assignment-create", ctx, { cohortId: 2, title: "B" });
    const all = call("assignment-list", ctx, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.assignments.length, 2);
    const c1 = call("assignment-list", ctx, { cohortId: 1 });
    assert.equal(c1.result.assignments.length, 1);
    assert.equal(c1.result.assignments[0].submissionCount, 0);
  });

  it("deletes an assignment", () => {
    const a = call("assignment-create", ctx, { cohortId: 3, title: "Temp" });
    const r = call("assignment-delete", ctx, { assignmentId: a.result.assignment.id });
    assert.equal(r.ok, true);
    assert.equal(call("assignment-list", ctx, {}).result.assignments.length, 0);
  });
});

describe("classroom submissions + gradebook", () => {
  it("submits work and grades it, returning feedback", () => {
    const a = call("assignment-create", ctx, { cohortId: 5, title: "Lab", points: 100 });
    const aid = a.result.assignment.id;
    const sub = call("submission-create", ctx, {
      assignmentId: aid, studentId: "student_x", content: "my answer",
    });
    assert.equal(sub.ok, true);
    const g = call("grade-submission", ctx, {
      submissionId: sub.result.submission.id, score: 88, feedback: "Solid work",
    });
    assert.equal(g.ok, true);
    assert.equal(g.result.grade.score, 88);
    assert.equal(g.result.grade.percent, 88);
    assert.equal(g.result.grade.feedback, "Solid work");
    // submission-list surfaces the attached grade
    const list = call("submission-list", ctx, { assignmentId: aid });
    assert.equal(list.result.submissions[0].grade.score, 88);
    assert.equal(list.result.submissions[0].status, "returned");
  });

  it("builds a gradebook matrix with class average", () => {
    const a = call("assignment-create", ctx, { cohortId: 9, title: "Quiz1", points: 100 });
    const aid = a.result.assignment.id;
    const s1 = call("submission-create", ctx, { assignmentId: aid, studentId: "s1", content: "x" });
    const s2 = call("submission-create", ctx, { assignmentId: aid, studentId: "s2", content: "y" });
    call("grade-submission", ctx, { submissionId: s1.result.submission.id, score: 80 });
    call("grade-submission", ctx, { submissionId: s2.result.submission.id, score: 100 });
    const gb = call("gradebook", ctx, { cohortId: 9 });
    assert.equal(gb.ok, true);
    assert.equal(gb.result.studentCount, 2);
    assert.equal(gb.result.classAverage, 90);
    assert.equal(gb.result.rows.length, 2);
  });

  it("rejects grading an unknown submission", () => {
    const r = call("grade-submission", ctx, { submissionId: "nope", score: 10 });
    assert.equal(r.ok, false);
  });
});

describe("classroom stream / announcements", () => {
  it("posts an announcement and lists the stream", () => {
    const r = call("announce", ctx, { text: "Welcome to class", cohortId: 4 });
    assert.equal(r.ok, true);
    const s = call("stream-list", ctx, { cohortId: 4 });
    assert.equal(s.ok, true);
    assert.ok(s.result.stream.some((e) => e.text === "Welcome to class"));
  });

  it("rejects an empty announcement", () => {
    assert.equal(call("announce", ctx, { text: "" }).ok, false);
  });

  it("logs assignment + grade events into the stream automatically", () => {
    call("assignment-create", ctx, { cohortId: 8, title: "Auto" });
    const s = call("stream-list", ctx, { cohortId: 8 });
    assert.ok(s.result.stream.some((e) => e.kind === "assignment"));
  });
});

describe("classroom materials", () => {
  it("adds, lists by topic, and deletes a material", () => {
    const m = call("material-add", ctx, {
      cohortId: 2, title: "Khan Academy", kind: "link",
      url: "https://khanacademy.org", topic: "Algebra",
    });
    assert.equal(m.ok, true);
    const list = call("material-list", ctx, { cohortId: 2 });
    assert.equal(list.ok, true);
    assert.ok(list.result.byTopic.Algebra);
    const del = call("material-delete", ctx, { materialId: m.result.material.id });
    assert.equal(del.ok, true);
    assert.equal(call("material-list", ctx, { cohortId: 2 }).result.materials.length, 0);
  });

  it("rejects a material without title", () => {
    assert.equal(call("material-add", ctx, { cohortId: 1 }).ok, false);
  });
});

describe("classroom student to-do", () => {
  it("buckets work into upcoming / missing / done", () => {
    const a = call("assignment-create", ctx, {
      cohortId: 6, title: "Past due", dueAt: "2020-01-01T00:00:00Z",
    });
    call("assignment-create", ctx, {
      cohortId: 6, title: "Future", dueAt: "2099-01-01T00:00:00Z",
    });
    const t = call("todo", ctx, { cohortId: 6, studentId: "stu" });
    assert.equal(t.ok, true);
    assert.equal(t.result.counts.missing, 1);
    assert.equal(t.result.counts.upcoming, 1);
    // submit + grade -> done bucket
    const sub = call("submission-create", ctx, {
      assignmentId: a.result.assignment.id, studentId: "stu", content: "late",
    });
    call("grade-submission", ctx, { submissionId: sub.result.submission.id, score: 40 });
    const t2 = call("todo", ctx, { cohortId: 6, studentId: "stu" });
    assert.equal(t2.result.counts.done, 1);
  });
});

describe("classroom quizzes (auto-graded)", () => {
  it("creates a quiz, hides answers, and auto-grades a submission", () => {
    const qz = call("quiz-create", ctx, {
      cohortId: 11, title: "Pop quiz",
      questions: [
        { kind: "multiple_choice", prompt: "2+2?", options: ["3", "4", "5"], correctAnswer: "4", points: 2 },
        { kind: "true_false", prompt: "Sky is blue", correctAnswer: "True", points: 1 },
        { kind: "short_answer", prompt: "Capital of France", correctAnswer: "Paris", points: 1 },
      ],
    });
    assert.equal(qz.ok, true);
    assert.equal(qz.result.quiz.totalPoints, 4);
    // returned questions must not leak correctAnswer
    for (const q of qz.result.quiz.questions) {
      assert.equal(q.correctAnswer, undefined);
    }
    const quizId = qz.result.quiz.id;
    const qids = qz.result.quiz.questions.map((q) => q.id);
    const attempt = call("quiz-submit", ctx, {
      quizId, studentId: "learner",
      answers: { [qids[0]]: "4", [qids[1]]: "False", [qids[2]]: "paris" },
    });
    assert.equal(attempt.ok, true);
    // q0 correct (2) + q1 wrong (0) + q2 correct case-insensitive (1) = 3/4
    assert.equal(attempt.result.attempt.score, 3);
    assert.equal(attempt.result.attempt.percent, 75);
  });

  it("rejects a quiz with no questions", () => {
    assert.equal(call("quiz-create", ctx, { cohortId: 1, title: "Empty", questions: [] }).ok, false);
  });

  it("rejects a multiple-choice question with too few options", () => {
    const r = call("quiz-create", ctx, {
      cohortId: 1, title: "Bad",
      questions: [{ kind: "multiple_choice", prompt: "?", options: ["only"], correctAnswer: "only" }],
    });
    assert.equal(r.ok, false);
  });

  it("lists quizzes and aggregates attempts", () => {
    const qz = call("quiz-create", ctx, {
      cohortId: 12, title: "Stats",
      questions: [{ kind: "short_answer", prompt: "x", correctAnswer: "y", points: 1 }],
    });
    const qid = qz.result.quiz.id;
    const ans = qz.result.quiz.questions[0].id;
    call("quiz-submit", ctx, { quizId: qid, answers: { [ans]: "y" } });
    call("quiz-submit", ctx, { quizId: qid, answers: { [ans]: "wrong" } });
    const list = call("quiz-list", ctx, { cohortId: 12 });
    assert.equal(list.ok, true);
    assert.equal(list.result.quizzes[0].attemptCount, 2);
    const attempts = call("quiz-attempts", ctx, { quizId: qid });
    assert.equal(attempts.ok, true);
    assert.equal(attempts.result.count, 2);
    assert.equal(attempts.result.averagePercent, 50);
  });

  it("quiz-get returns a quiz without leaking answers", () => {
    const qz = call("quiz-create", ctx, {
      cohortId: 13, title: "G",
      questions: [{ kind: "true_false", prompt: "?", correctAnswer: "True", points: 1 }],
    });
    const got = call("quiz-get", ctx, { quizId: qz.result.quiz.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.quiz.questions[0].correctAnswer, undefined);
  });
});

describe("classroom Open Library macros (bad-input guards)", () => {
  it("ol-search rejects empty query set", async () => {
    assert.equal((await call("ol-search", ctx, {})).ok, false);
  });
  it("ol-work rejects malformed work id", async () => {
    assert.equal((await call("ol-work", ctx, { workId: "bad" })).ok, false);
  });
  it("ol-isbn rejects a non-10/13 digit isbn", async () => {
    assert.equal((await call("ol-isbn", ctx, { isbn: "123" })).ok, false);
  });
  it("ol-subject rejects an empty subject", async () => {
    assert.equal((await call("ol-subject", ctx, { subject: "" })).ok, false);
  });
});
