import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerClassroomActions from "../domains/classroom.js";

const actions = new Map();
registerClassroomActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`classroom:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "classroom", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-classroom-007: quiz-delete removes the quiz and its attempts", () => {
  const quiz = call("quiz-create", {
    title: "Pop quiz", cohortId: 1,
    questions: [{ kind: "multiple_choice", prompt: "2+2?", options: ["3", "4"], correctAnswer: "4", points: 1 }],
  }).result.quiz;
  const attempt = call("quiz-submit", { quizId: quiz.id, answers: ["4"] });
  assert.equal(attempt.ok, true, JSON.stringify(attempt));
  const del = call("quiz-delete", { quizId: quiz.id });
  assert.equal(del.ok, true);
  assert.equal(del.result.attemptsRemoved, 1);
  assert.equal(call("quiz-list", {}).result.quizzes.length, 0);
  assert.equal(call("quiz-delete", { quizId: quiz.id }).ok, false);
});

test("FIX-classroom-007: submission-delete removes the submission and its grade", () => {
  const asg = call("assignment-create", { title: "Essay", cohortId: 1 }).result.assignment;
  const sub = call("submission-create", { assignmentId: asg.id, content: "My essay" }).result.submission;
  const graded = call("grade-submission", { submissionId: sub.id, score: 9 });
  assert.equal(graded.ok, true, JSON.stringify(graded));
  const del = call("submission-delete", { submissionId: sub.id });
  assert.equal(del.ok, true);
  assert.equal(del.result.gradesRemoved, 1);
  assert.equal(call("submission-list", { assignmentId: asg.id }).result.submissions.length, 0);
});

test("FIX-classroom-007: stream-delete removes an announcement from the caller's stream", () => {
  const entry = call("announce", { text: "Field trip Friday", cohortId: 1 }).result.entry;
  assert.equal(call("stream-delete", { entryId: entry.id }).ok, true);
  assert.equal(call("stream-list", {}).result.stream.length, 0);
  // Another user cannot reach it (per-user stream state).
  const e2 = call("announce", { text: "Mine", cohortId: 1 }).result.entry;
  assert.equal(call("stream-delete", { entryId: e2.id }, "u2").ok, false);
});

test("FIX-classroom-007 stream leg: a posted assignment appears in the stream (verify pin)", () => {
  call("assignment-create", { title: "Essay 1", cohortId: 1 });
  const stream = call("stream-list", { cohortId: 1 }).result.stream;
  assert.equal(stream.length, 1);
  assert.equal(stream[0].kind, "assignment");
  assert.match(stream[0].text, /Essay 1/);
});
