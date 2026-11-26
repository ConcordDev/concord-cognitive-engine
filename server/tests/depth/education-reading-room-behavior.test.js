// tests/depth/education-reading-room-behavior.test.js — Education as the
// Reading Room. A creator publishes a course of real lessons (a reading, a
// video, a check graded on the server); a learner enrolls (free, or buys it
// in CC), reads, passes the checks and earns a certificate anyone can
// verify. Nothing can be faked: answers never reach the browser, lessons
// can't be completed by id, certificates need every lesson done, reviews
// come only from learners, and only the creator edits the course.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { gradeCheck, cleanLesson } from "../../lib/reading-room.js";

let STATE;
const run = (a, p, ctx) => lensRun("education", a, { params: p }, ctx);
const ok = (r) => { assert.equal(r.ok, true, r.error || JSON.stringify(r)); return r.result; };
const wallet = (id) => getBalance(STATE.db, id).balance;
function user(id, username) { STATE.db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', datetime('now'))").run(id, username, `${username}@example.com`); }

const CHECK = {
  passMark: 0.67,
  questions: [
    { id: "q1", type: "choice", prompt: "What is the moment of 10 N at 2 m?", options: ["5 N·m", "12 N·m", "20 N·m"], answer: 2, explain: "Moment = force × distance." },
    { id: "q2", type: "numeric", prompt: "Sum of moments about a support in equilibrium?", answer: 0, tolerance: 0, explain: "Equilibrium means they balance." },
    { id: "q3", type: "text", prompt: "Name the point a beam rotates about.", answer: ["pivot", "fulcrum"], explain: "Also called the fulcrum." },
  ],
};

before(async () => {
  ({ STATE } = await load());
  for (const [id, n] of [["rr-ada", "ada_rr"], ["rr-ben", "ben_rr"], ["rr-cy", "cy_rr"]]) user(id, n);
});

describe("the rules themselves", () => {
  it("grades each question type exactly, and a check passes at its mark", () => {
    const g = gradeCheck(CHECK, { q1: 2, q2: "0", q3: " Fulcrum. " });
    assert.deepEqual([g.right, g.total, g.passed], [3, 3, true]);
    const h = gradeCheck(CHECK, { q1: 1, q2: 0, q3: "hinge" });
    assert.deepEqual([h.right, h.passed], [1, false]);
    const multi = { passMark: 1, questions: [{ id: "m", type: "multi", options: ["a", "b", "c"], answer: [0, 2] }] };
    assert.equal(gradeCheck(multi, { m: [2, 0] }).passed, true);
    assert.equal(gradeCheck(multi, { m: [0] }).passed, false);
  });
  it("refuses a lesson with nothing in it, a check without an answer, an http video", () => {
    assert.match(cleanLesson({ title: "Empty" }).error, /reading, a video or a check/);
    assert.match(cleanLesson({ title: "Q", check: { questions: [{ type: "choice", prompt: "?", options: ["a", "b"] }] } }).error, /choose which option/);
    assert.match(cleanLesson({ title: "V", video: { url: "http://example.com/v.mp4" } }).error, /https/);
  });
});

describe("a free course, start to certificate", () => {
  let ada, ben, cy, course, l1, l2;
  before(async () => {
    ada = await depthCtx("rr-ada"); ben = await depthCtx("rr-ben"); cy = await depthCtx("rr-cy");
    course = ok(await run("rr-course-save", { title: "Statics for everyone", summary: "Forces, moments and why bridges stand up.", category: "engineering", level: "beginner", outcomes: ["Take moments about a point"] }, ada)).course;
    l1 = ok(await run("rr-lesson-save", { courseId: course.id, title: "Forces", body: "# Forces\nA force is a push or a pull…", durationMin: 8, preview: true }, ada)).lesson;
    l2 = ok(await run("rr-lesson-save", { courseId: course.id, title: "Moments", body: "A moment is force × distance.", check: CHECK, durationMin: 12 }, ada)).lesson;
  });

  it("a draft is invisible until published; publishing needs a lesson and a summary", async () => {
    assert.equal(ok(await run("rr-catalog", {}, ben)).courses.some((c) => c.id === course.id), false);
    assert.match((await run("rr-course", { id: course.id }, ben)).error, /course not found/);
    const empty = ok(await run("rr-course-save", { title: "Nothing yet" }, ada)).course;
    assert.match((await run("rr-publish", { id: empty.id }, ada)).error, /at least one lesson/);
    ok(await run("rr-publish", { id: course.id }, ada));
    const listed = ok(await run("rr-catalog", { q: "bridges" }, ben)).courses.find((c) => c.id === course.id);
    assert.deepEqual([listed.lessons, listed.minutes, listed.priceCC, listed.creator.name, listed.learners], [2, 20, 0, "ada_rr", 0]);
  });

  it("only the creator edits the course, and nobody can set its rating", async () => {
    assert.match((await run("rr-lesson-save", { courseId: course.id, title: "Sneaky", body: "x" }, ben)).error, /course not found/);
    assert.match((await run("rr-course-save", { id: course.id, title: "Mine now" }, ben)).error, /course not found/);
    assert.match((await run("rr-studio", { id: course.id }, ben)).error, /course not found/);
    ok(await run("courses-update", { id: course.id, rating: 5 }, ada));
    assert.equal(ok(await run("rr-course", { id: course.id }, ben)).course.rating, null);
  });

  it("check answers never leave the server — not from the lesson, not from the old course views", async () => {
    ok(await run("rr-enroll", { courseId: course.id }, ben));
    const lesson = ok(await run("rr-lesson", { courseId: course.id, lessonId: l2.id }, ben)).lesson;
    assert.equal(lesson.check.questions.length, 3);
    for (const q of lesson.check.questions) { assert.equal("answer" in q, false); assert.equal("explain" in q, false); }
    const old = ok(await run("courses-get", { id: course.id }, ben)).course;
    assert.ok(!JSON.stringify(old).includes("fulcrum"), "the old course view strips the check");
    assert.equal(old.lessons[1].checkQuestions, 3);
    const list = ok(await run("courses-list", {}, ben)).courses.find((c) => c.id === course.id);
    assert.ok(!JSON.stringify(list).includes("\"answer\""));
  });

  it("completion has to be earned — the old fake-completion path is closed", async () => {
    // the old way: post any lesson id
    assert.match((await run("lessons-complete", { courseId: course.id, lessonId: "less_made_up" }, cy)).error, /course not found|lesson not found|enroll/);
    assert.match((await run("lessons-complete", { courseId: course.id, lessonId: l1.id }, cy)).error, /enroll/);
    assert.match((await run("rr-complete", { courseId: course.id, lessonId: l2.id }, ben)).error, /pass this lesson's check \(67%\)/);
    const fresh = await depthCtx("rr-cy");
    ok(await run("rr-enroll", { courseId: course.id }, fresh));
    assert.match((await run("rr-complete", { courseId: course.id, lessonId: l1.id }, fresh)).error, /open the lesson/);
    assert.match((await run("certificates-issue", { courseId: course.id }, fresh)).error, /2 lessons still to finish/);
  });

  it("a failed check explains without giving the answers; a pass completes the lesson and reveals them", async () => {
    const fail = ok(await run("rr-check", { courseId: course.id, lessonId: l2.id, answers: { q1: 0, q2: 5, q3: "hinge" } }, ben));
    assert.deepEqual([fail.passed, fail.right, fail.attempts], [false, 0, 1]);
    assert.equal(fail.results[0].explain, "Moment = force × distance.");
    assert.equal("answer" in fail.results[0], false);
    const pass = ok(await run("rr-check", { courseId: course.id, lessonId: l2.id, answers: { q1: 2, q2: 0, q3: "fulcrum" } }, ben));
    assert.deepEqual([pass.passed, pass.score, pass.results[0].answer], [true, 1, 2]);
    ok(await run("rr-lesson", { courseId: course.id, lessonId: l1.id }, ben));
    const done = ok(await run("rr-complete", { courseId: course.id, lessonId: l1.id }, ben));
    assert.deepEqual([done.done, done.total], [2, 2]);
  });

  it("the certificate is earned once and anyone can verify it", async () => {
    const c = ok(await run("rr-certificate", { courseId: course.id }, ben));
    assert.match(c.code, /^RR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.deepEqual([c.certificate.learner, c.certificate.course, c.certificate.creator, c.certificate.lessons, c.certificate.averageScore], ["ben_rr", "Statics for everyone", "ada_rr", 2, 100]);
    assert.equal(ok(await run("rr-certificate", { courseId: course.id }, ben)).code, c.code, "asking again returns the same certificate");
    // Signed-out visitors verify through the public route, which calls this same handler as "anon".
    const verify = globalThis.__concordLensActions.get("education.rr-verify");
    const anon = { db: STATE.db, actor: { userId: "anon" } };
    assert.equal((await verify(anon, {}, { code: c.code.toLowerCase() })).result.certificate.learner, "ben_rr");
    assert.match((await verify(anon, {}, { code: "RR-AAAA-BBBB-CCCC-DDDD" })).error, /no certificate/);
    assert.match((await run("rr-certificate", { courseId: course.id }, ada)).error, /own creator/);
  });

  it("only learners review, once each; the course rating is their average", async () => {
    assert.match((await run("rr-review", { courseId: course.id, stars: 5 }, ada)).error, /your own course/);
    const stranger = await depthCtx("rr-stranger");
    assert.match((await run("rr-review", { courseId: course.id, stars: 1 }, stranger)).error, /only learners/);
    ok(await run("rr-review", { courseId: course.id, stars: 4, text: "Clear." }, ben));
    const r = ok(await run("rr-review", { courseId: course.id, stars: 5, text: "Clearer on a second read." }, ben));
    assert.deepEqual([r.reviews, r.rating], [1, 5]);
  });

  it("the creator sees the funnel, the check results and the learners", async () => {
    const d = ok(await run("rr-learners", { courseId: course.id }, ada));
    assert.deepEqual([d.learners, d.certificates, d.revenueCC], [2, 1, 0]);
    const ml = d.lessons.find((l) => l.id === l2.id);
    assert.deepEqual([ml.done, ml.check.attempts, ml.check.passRate, ml.check.avgScore], [1, 2, 50, 50]);
    assert.equal(d.people[0].name, "ben_rr");
    assert.match((await run("rr-learners", { courseId: course.id }, ben)).error, /course not found/);
  });

  it("the tutor is honest when no model is running", async () => {
    const r = await run("rr-tutor", { courseId: course.id, lessonId: l1.id, question: "Why does a beam not fall?" }, { ...ben, llm: undefined });
    if (r.ok === false) assert.match(r.error, /tutor isn't available|lesson not found/);
    const old = await run("tutor-ask", { subject: "physics" }, { ...ben, llm: undefined });
    if (old.ok === false) assert.match(old.error, /tutor isn't available/);
    else assert.ok(!String(old.result?.text || "").includes("(tutor unavailable"), "never a fake success");
  });
});

describe("a paid course", () => {
  let ada, ben, cy, course, prev, paid;
  before(async () => {
    ada = await depthCtx("rr-ada"); ben = await depthCtx("rr-ben"); cy = await depthCtx("rr-cy");
    course = ok(await run("rr-course-save", { title: "Advanced trusses", summary: "Method of joints and sections.", priceCC: 6 }, ada)).course;
    prev = ok(await run("rr-lesson-save", { courseId: course.id, title: "Why trusses", body: "Triangles don't fold.", preview: true }, ada)).lesson;
    paid = ok(await run("rr-lesson-save", { courseId: course.id, title: "Method of joints", body: "Sum forces at each pin.", check: CHECK }, ada)).lesson;
    ok(await run("rr-publish", { id: course.id }, ada));
  });
  it("the preview is open to anyone; the rest is locked until bought", async () => {
    assert.equal(ok(await run("rr-lesson", { courseId: course.id, lessonId: prev.id }, cy)).lesson.body, "Triangles don't fold.");
    const locked = ok(await run("rr-lesson", { courseId: course.id, lessonId: paid.id }, cy));
    assert.deepEqual([locked.lesson.locked, locked.lesson.body, locked.reason], [true, undefined, "This lesson is part of the course (6 CC)."]);
    assert.match((await run("rr-check", { courseId: course.id, lessonId: paid.id, answers: {} }, cy)).error, /enroll/);
  });
  it("buying pays the creator through the marketplace and opens the course", async () => {
    setLedgerBalance(STATE.db, "rr-cy", 2);
    assert.match((await run("rr-enroll", { courseId: course.id }, cy)).error, /not enough Concord Coin: this course is 6 CC and you have 2 CC/);
    setLedgerBalance(STATE.db, "rr-cy", 10); setLedgerBalance(STATE.db, "rr-ada", 0);
    const r = ok(await run("rr-enroll", { courseId: course.id }, cy));
    assert.deepEqual([r.enrolled, r.paid], [true, 6]);
    assert.equal(wallet("rr-cy"), 4);
    assert.ok(wallet("rr-ada") >= 5.7 - 1e-9, `creator got ${wallet("rr-ada")}`);
    assert.equal(ok(await run("rr-lesson", { courseId: course.id, lessonId: paid.id }, cy)).lesson.locked, false);
    assert.match((await run("rr-enroll", { courseId: course.id }, cy)).error, /already enrolled/);
    assert.match((await run("rr-enroll", { courseId: course.id }, ada)).error, /your own course/);
    assert.equal(ok(await run("rr-learners", { courseId: course.id }, ada)).revenueCC, 6);
  });
  it("a published course can't flip between free and paid, and prices are checked", async () => {
    assert.match((await run("rr-course-save", { id: course.id, priceCC: 0 }, ada)).error, /unpublish/);
    assert.match((await run("rr-course-save", { id: course.id, priceCC: 0.1 }, ada)).error, /0\.5 to 1000/);
  });
});

describe("the lesson margin: questions and answers belong to the course's people", () => {
  let ada, ben, cy, dee, course, lesson;
  before(async () => {
    user("rr-dee", "dee_rr");
    ada = await depthCtx("rr-ada"); ben = await depthCtx("rr-ben"); cy = await depthCtx("rr-cy"); dee = await depthCtx("rr-dee");
    course = ok(await run("rr-course-save", { title: "Margins", summary: "Asking good questions." }, ada)).course;
    lesson = ok(await run("rr-lesson-save", { courseId: course.id, title: "One", body: "Read me." }, ada)).lesson;
    ok(await run("rr-publish", { id: course.id }, ada));
    ok(await run("rr-enroll", { courseId: course.id }, ben));
    ok(await run("rr-enroll", { courseId: course.id }, cy));
  });

  it("an outsider can neither ask nor read; a learner asks at a moment in the lesson", async () => {
    const out = await run("discussions-post", { courseId: course.id, lessonId: lesson.id, text: "hi?" }, dee);
    assert.equal(out.result.ok, false);
    assert.match(out.result.error, /enroll/);
    assert.equal((await run("discussions-post", { courseId: course.id, lessonId: "nope", text: "?" }, ben)).result.ok, false);
    assert.equal((await run("discussions-post", { courseId: course.id, lessonId: lesson.id, text: "?", timestampSec: -3 }, ben)).result.ok, false);
    const q = ok(await run("discussions-post", { courseId: course.id, lessonId: lesson.id, text: "Why does it balance?", timestampSec: 42.37 }, ben)).post;
    assert.equal(q.lessonId, lesson.id);
    assert.equal(q.timestampSec, 42.4);
    assert.equal(ok(await run("discussions-list", { courseId: course.id, lessonId: lesson.id }, dee)).discussions.length, 0);
  });

  it("the creator answers, the asker accepts; nobody else can accept, and votes are one each", async () => {
    const q = ok(await run("discussions-list", { courseId: course.id, lessonId: lesson.id }, ben)).discussions.find((d) => !d.replyTo);
    const a = ok(await run("discussions-post", { courseId: course.id, text: "Moments cancel.", replyTo: q.id }, ada)).post;
    const thread = ok(await run("discussions-list", { courseId: course.id, lessonId: lesson.id }, cy)).discussions;
    assert.equal(thread.length, 2, "a lesson's Q&A is its questions and their replies");
    assert.match((await run("discussions-accept", { id: q.id, answerId: a.id }, cy)).result.error, /only the person who asked/);
    assert.match((await run("discussions-accept", { id: a.id, answerId: q.id }, ben)).result.error, /only a question/);
    const done = ok(await run("discussions-accept", { id: q.id, answerId: a.id }, ben)).post;
    assert.equal(done.acceptedId, a.id);
    const row = STATE.db.prepare("SELECT accepted_id FROM edu_discussions WHERE id = ?").get(q.id);
    assert.equal(row.accepted_id, a.id, "the accepted answer is stored");
    assert.equal(ok(await run("discussions-upvote", { id: a.id }, cy)).upvotes, 1);
    assert.equal((await run("discussions-upvote", { id: a.id }, cy)).result.ok, false);
    assert.equal((await run("discussions-upvote", { id: a.id }, ada)).result.ok, false, "no voting for yourself");
  });
});
