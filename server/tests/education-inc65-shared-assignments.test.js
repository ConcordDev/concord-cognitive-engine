// INC-65 — education assignments are course-scoped, and course / cohort /
// discussion reads do not hand another account's raw user id to the caller.
//
// Two (plus) disposable accounts, matching the 2026-10-11 QA pass:
// acct1 publishes a course and an assignment; acct2 enrolls and submits;
// acct1 sees that submission; acct2 does not see a classmate's submission;
// a stranger cannot submit; a different enrolled learner can peer-review
// and the submitter cannot review themselves; list/get payloads carry
// {isMine, displayName|label} and rosterCount instead of raw ids;
// cohorts-join ignores a planted learner id unless the caller is the author.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEducationActions from "../domains/education.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`education.${name}`);
  assert.ok(fn, `education.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const acct1 = "edu-acct1-7f3a9c";
const acct2 = "edu-acct2-1b4e88";
const acct3 = "edu-acct3-6d2c55";
const outsider = "edu-outsider-0aa1";
const planted = "someone-else-id";

const ctx1 = { actor: { userId: acct1 }, userId: acct1 };
const ctx2 = { actor: { userId: acct2 }, userId: acct2 };
const ctx3 = { actor: { userId: acct3 }, userId: acct3 };
const ctxOut = { actor: { userId: outsider }, userId: outsider };

function assertNoRawId(payload, rawId, where) {
  assert.equal(JSON.stringify(payload).includes(rawId), false, `${where} leaked raw id ${rawId}`);
}

before(() => { registerEducationActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), educationLens: { decks: new Map(), cards: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("education INC-65 — shared assignments, hidden ids, roster join", () => {
  it("enrolled learner submits to the author's assignment; author sees it; classmates and strangers do not", () => {
    const course = call("courses-create", ctx1, { title: "Shared Lab", status: "published" });
    assert.equal(course.ok, true, course.error);
    const courseId = course.result.course.id;

    const denied = call("assignments-create", ctx2, { courseId, title: "Hijack", peerReviewCount: 1 });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /not authorized/);

    const created = call("assignments-create", ctx1, { courseId, title: "Lab 1", peerReviewCount: 1, maxPoints: 100 });
    assert.equal(created.ok, true, created.error);
    const assignmentId = created.result.assignment.id;

    // Stored under the course, not the author's private bucket.
    const lens = globalThis._concordSTATE.educationLens;
    assert.ok(lens.assignments.get(courseId).some((a) => a.id === assignmentId));
    assert.equal(lens.assignments.has(acct1), false);

    const listed = call("assignments-list", ctx2, { courseId });
    assert.equal(listed.ok, true);
    assert.ok(listed.result.assignments.some((a) => a.id === assignmentId));

    const stranger = call("assignments-submit", ctxOut, { assignmentId, text: "not in the class" });
    assert.equal(stranger.ok, false);
    assert.match(stranger.error, /not enrolled/);

    const beforeEnroll = call("assignments-submit", ctx2, { assignmentId, text: "too early" });
    assert.equal(beforeEnroll.ok, false);
    assert.match(beforeEnroll.error, /not enrolled/);

    assert.equal(call("enrollments-enroll", ctx2, { courseId }).ok, true);
    const submitted = call("assignments-submit", ctx2, { assignmentId, text: "acct2 essay" });
    assert.equal(submitted.ok, true, submitted.error);
    assert.equal(submitted.result.submission.status, "awaiting_peer_review");
    assert.equal(submitted.result.submission.learner.isMine, true);
    assertNoRawId(submitted, acct1, "submit response");
    const submissionId = submitted.result.submission.id;

    assert.equal(call("enrollments-enroll", ctx3, { courseId }).ok, true);
    const other = call("assignments-submit", ctx3, { assignmentId, text: "acct3 essay" });
    assert.equal(other.ok, true, other.error);

    const authorView = call("assignments-submissions", ctx1, { assignmentId });
    assert.equal(authorView.ok, true, authorView.error);
    assert.equal(authorView.result.total, 2);
    const seen = authorView.result.submissions.find((s) => s.text === "acct2 essay");
    assert.ok(seen, "author should see the enrolled learner's submission");
    assert.equal(seen.learner.isMine, false);
    assert.ok(seen.learner.displayName || seen.learner.label);
    assertNoRawId(authorView, acct2, "author submissions");
    assertNoRawId(authorView, acct3, "author submissions");

    const learnerView = call("assignments-submissions", ctx2, { assignmentId });
    assert.equal(learnerView.result.total, 1);
    assert.equal(learnerView.result.submissions[0].text, "acct2 essay");
    assert.equal(learnerView.result.submissions[0].learner.isMine, true);
    assert.equal(JSON.stringify(learnerView).includes("acct3 essay"), false);
    assertNoRawId(learnerView, acct1, "learner submissions");
    assertNoRawId(learnerView, acct3, "learner submissions");

    const self = call("assignments-peer-review", ctx2, { submissionId, score: 99, feedback: "mine" });
    assert.equal(self.ok, false);
    assert.match(self.error, /cannot review your own submission/);

    const strangerReview = call("assignments-peer-review", ctxOut, { submissionId, score: 10, feedback: "nope" });
    assert.equal(strangerReview.ok, false);
    assert.match(strangerReview.error, /not enrolled/);

    const review = call("assignments-peer-review", ctx3, { submissionId, score: 88, feedback: "clear argument" });
    assert.equal(review.ok, true, review.error);
    assert.equal(review.result.submission.peerReviews.length, 1);
    assert.equal(review.result.submission.peerReviews[0].score, 88);
    assert.equal(review.result.submission.peerReviews[0].reviewer.label, "Classmate");
    assertNoRawId(review, acct2, "peer-review response");
    assertNoRawId(review, acct1, "peer-review response");

    const again = call("assignments-peer-review", ctx3, { submissionId, score: 70, feedback: "second" });
    assert.equal(again.ok, false);
    assert.match(again.error, /already reviewed/);

    assert.equal(call("enrollments-enroll", ctxOut, { courseId }).ok, true);
    const capped = call("assignments-peer-review", ctxOut, { submissionId, score: 50, feedback: "late" });
    assert.equal(capped.ok, false);
    assert.match(capped.error, /peer review limit reached/);

    const after = call("assignments-submissions", ctx2, { assignmentId });
    const mine = after.result.submissions[0];
    assert.equal(mine.peerReviews.length, 1);
    assert.equal(mine.peerReviews[0].score, 88);
    assert.equal(mine.peerReviews[0].feedback, "clear argument");
    assert.equal(mine.peerReviews[0].reviewer.label, "Classmate");
    assert.equal(mine.peerReviews[0].reviewerId, undefined);
    assertNoRawId(after, acct3, "submitter peer-review view");

    const stored = lens.submissions.get(courseId).find((s) => s.id === submissionId);
    assert.equal(stored.learnerId, acct2);
    assert.equal(stored.peerReviews[0].reviewerId, acct3);
  });

  it("courses-get, courses-list, cohorts-list, and discussions-list hide the other account's id", () => {
    const course = call("courses-create", ctx1, { title: "Visible Course", instructor: "Dr One" });
    const courseId = course.result.course.id;
    call("discussions-post", ctx1, { courseId, text: "prompt from the author" });
    call("discussions-post", ctx2, { courseId, text: "reply from the learner" });

    const cohort = call("cohorts-create", ctx1, { title: "Section A", instructor: "Dr One", courseId, capacity: 10 });
    const cohortId = cohort.result.cohort.id;
    assert.equal(call("cohorts-join", ctx2, { id: cohortId }).ok, true);

    const gotBy2 = call("courses-get", ctx2, { id: courseId });
    assert.equal(gotBy2.ok, true);
    assert.equal(gotBy2.result.course.authorId, undefined);
    assert.equal(gotBy2.result.course.author.isMine, false);
    assert.ok(gotBy2.result.course.author.displayName || gotBy2.result.course.author.label);
    assertNoRawId(gotBy2, acct1, "acct2 courses-get");

    const listBy2 = call("courses-list", ctx2, {});
    assert.ok(listBy2.result.courses.some((c) => c.id === courseId));
    assertNoRawId(listBy2, acct1, "acct2 courses-list");

    const searchBy2 = call("courses-search", ctx2, { query: "Visible" });
    assert.ok(searchBy2.result.matches.some((c) => c.id === courseId));
    assertNoRawId(searchBy2, acct1, "acct2 courses-search");

    assert.equal(call("enrollments-enroll", ctx2, { courseId }).ok, true);
    const enrolled = call("enrollments-list", ctx2, {});
    assert.ok(enrolled.result.enrollments.some((e) => e.courseId === courseId));
    assertNoRawId(enrolled, acct1, "acct2 enrollments-list");

    const gotBy1 = call("courses-get", ctx1, { id: courseId });
    assert.equal(gotBy1.result.course.author.isMine, true);
    assert.equal(gotBy1.result.course.authorId, undefined);
    assertNoRawId(gotBy1, acct2, "acct1 courses-get");

    const listBy1 = call("courses-list", ctx1, {});
    assertNoRawId(listBy1, acct2, "acct1 courses-list");

    const cohortsFor2 = call("cohorts-list", ctx2, { courseId });
    const row2 = cohortsFor2.result.cohorts.find((c) => c.id === cohortId);
    assert.ok(row2);
    assert.equal(row2.authorId, undefined);
    assert.equal(row2.roster, undefined);
    assert.equal(row2.rosterCount, 1);
    assert.equal(row2.author.isMine, false);
    assertNoRawId(cohortsFor2, acct1, "acct2 cohorts-list");

    const cohortsFor1 = call("cohorts-list", ctx1, { courseId });
    const row1 = cohortsFor1.result.cohorts.find((c) => c.id === cohortId);
    assert.equal(row1.rosterCount, 1);
    assert.equal(row1.author.isMine, true);
    assert.equal(row1.roster, undefined);
    assertNoRawId(cohortsFor1, acct2, "acct1 cohorts-list");

    const postsFor2 = call("discussions-list", ctx2, { courseId });
    assert.equal(postsFor2.result.discussions.length, 2);
    const authorPost = postsFor2.result.discussions.find((p) => p.text === "prompt from the author");
    assert.equal(typeof authorPost.author, "object");
    assert.equal(authorPost.author.isMine, false);
    assert.ok(authorPost.author.displayName || authorPost.author.label);
    assertNoRawId(postsFor2, acct1, "acct2 discussions-list");

    const postsFor1 = call("discussions-list", ctx1, { courseId });
    const learnerPost = postsFor1.result.discussions.find((p) => p.text === "reply from the learner");
    assert.equal(learnerPost.author.isMine, false);
    assertNoRawId(postsFor1, acct2, "acct1 discussions-list");

    // The id is still on the stored row.
    const storedCourse = globalThis._concordSTATE.educationLens.courses.get(courseId);
    assert.equal(storedCourse.authorId, acct1);
    const storedPost = [...globalThis._concordSTATE.educationLens.discussions.values()].find((p) => p.text === "reply from the learner");
    assert.equal(storedPost.author, acct2);
  });

  it("cohorts-join with a planted learner id adds only the caller", () => {
    const cohort = call("cohorts-create", ctx1, { title: "Section B", instructor: "Dr One", capacity: 2 });
    const id = cohort.result.cohort.id;

    const join = call("cohorts-join", ctx2, { id, learner: planted });
    assert.equal(join.ok, true, join.error);
    assertNoRawId(join, acct1, "non-author join response");
    assertNoRawId(join, planted, "non-author join response");
    assert.equal(join.result.cohort.roster, undefined);
    assert.equal(join.result.cohort.rosterCount, 1);

    const stored = globalThis._concordSTATE.educationLens.cohorts.get(id);
    assert.deepEqual(stored.roster, [acct2]);
    assert.equal(stored.roster.includes(planted), false);

    const again = call("cohorts-join", ctx2, { id, learner: planted });
    assert.equal(again.ok, false);
    assert.match(again.error, /already on roster/);

    // The planted id did not consume a seat. The other account still fits.
    const third = call("cohorts-join", ctx3, { id, learner: planted });
    assert.equal(third.ok, true, third.error);
    assert.deepEqual(stored.roster, [acct2, acct3]);

    const full = call("cohorts-join", ctxOut, { id, learner: planted });
    assert.equal(full.ok, false);
    assert.match(full.error, /at capacity/);
    assert.equal(stored.roster.includes(planted), false);

    // Leave with a planted id removes only the caller, never the planted string.
    const leave = call("cohorts-leave", ctx2, { id, learner: planted });
    assert.equal(leave.ok, true, leave.error);
    assert.deepEqual(stored.roster, [acct3]);
    assert.equal(stored.roster.includes(planted), false);
    assert.equal(leave.result.cohort.roster, undefined);
    assert.equal(leave.result.cohort.rosterCount, 1);
    assertNoRawId(leave, planted, "non-author leave response");
    assertNoRawId(leave, acct1, "non-author leave response");
  });
});
