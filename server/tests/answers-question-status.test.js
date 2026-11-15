// FIX-answers-001 pins — the Q&A community read model + explicit lifecycle status.
//
// Root cause: questions were stored per-author and EVERY read/interaction path
// resolved only the caller's own bucket, so no other user could ever see or
// answer a question — every question sat at 0 answers with no pending state,
// and the author-notification branch in answer-post was unreachable.
// Fix: community surfaces resolve across all buckets (findLiveAny/allLiveQs)
// while author-scoped verbs keep the own-bucket finder and their guards, and
// list/detail expose a derived `status` (awaiting-first-answer / answered /
// resolved / closed) that the FE renders as a pending state.
// Harness mirrors answers-full-build.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnswersActions from "../domains/answers.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`answers.${name}`);
  assert.ok(fn, `answers.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnswersActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

function ask() {
  return call("question-ask", ctxA, {
    title: "How do I center a div?",
    body: "I have tried flexbox but it is not working as expected.",
    tags: "css, layout",
  }).result.question;
}

describe("FIX-answers-001 — a question is visible to the community", () => {
  it("another user sees the fresh question in list, detail and search, marked awaiting-first-answer", () => {
    const q = ask();
    const listB = call("question-list", ctxB, {});
    assert.equal(listB.result.count, 1);
    assert.equal(listB.result.questions[0].id, q.id);
    assert.equal(listB.result.questions[0].answerCount, 0);
    assert.equal(listB.result.questions[0].status, "awaiting-first-answer");

    const detailB = call("question-detail", ctxB, { id: q.id });
    assert.equal(detailB.ok, true);
    assert.equal(detailB.result.question.status, "awaiting-first-answer");

    const found = call("search", ctxB, { query: "center" });
    assert.equal(found.result.count, 1);
    assert.equal(found.result.results[0].id, q.id);
  });

  it("another user can answer; the author is notified; status becomes answered, then resolved on accept", () => {
    const q = ask();
    const posted = call("answer-post", ctxB, {
      questionId: q.id,
      body: "Use display:flex on the parent element.",
    });
    assert.equal(posted.ok, true);

    const notifs = call("notifications", ctxA, {});
    assert.ok(
      notifs.result.notifications.some((n) => n.kind === "answer" && n.questionId === q.id),
      "author receives the new-answer notification",
    );

    assert.equal(call("question-detail", ctxA, { id: q.id }).result.question.status, "answered");
    assert.equal(call("question-list", ctxB, {}).result.questions[0].status, "answered");

    // the answer counts toward the answerer's reputation profile, not the author's
    assert.equal(call("user-reputation", ctxB, {}).result.answersPosted, 1);
    assert.equal(call("user-reputation", ctxA, {}).result.answersPosted, 0);

    const accepted = call("answer-accept", ctxA, { questionId: q.id, answerId: posted.result.answer.id });
    assert.equal(accepted.ok, true);
    assert.equal(call("question-detail", ctxB, { id: q.id }).result.question.status, "resolved");
  });

  it("a non-author cannot accept an answer on someone else's question", () => {
    const q = ask();
    const a = call("answer-post", ctxB, { questionId: q.id, body: "Use display:flex on the parent element." }).result.answer;
    assert.equal(call("answer-accept", ctxB, { questionId: q.id, answerId: a.id }).ok, false);
    assert.equal(call("answer-accept", ctxC, { questionId: q.id, answerId: a.id }).ok, false);
  });

  it("answer delete: a third party is refused; the answer author can delete, and the derived status falls back to awaiting", () => {
    const q = ask();
    const a = call("answer-post", ctxB, { questionId: q.id, body: "Use display:flex on the parent element." }).result.answer;
    assert.equal(call("answer-delete", ctxC, { questionId: q.id, answerId: a.id }).ok, false);
    assert.equal(call("question-detail", ctxA, { id: q.id }).result.question.answers.length, 1);

    assert.equal(call("answer-delete", ctxB, { questionId: q.id, answerId: a.id }).ok, true);
    const d = call("question-detail", ctxA, { id: q.id });
    assert.equal(d.result.question.answers.length, 0);
    assert.equal(d.result.question.status, "awaiting-first-answer");

    // and the answer author can restore their own answer again
    assert.equal(call("answer-restore", ctxB, { questionId: q.id, answerId: a.id }).ok, true);
    assert.equal(call("question-detail", ctxA, { id: q.id }).result.question.status, "answered");
  });

  it("question delete/restore stay author-scoped: another user cannot delete the question", () => {
    const q = ask();
    assert.equal(call("question-delete", ctxB, { id: q.id }).ok, false);
    assert.equal(call("question-detail", ctxB, { id: q.id }).ok, true);
    assert.equal(call("question-delete", ctxA, { id: q.id }).ok, true);
    // once the author deletes it, it leaves the community surfaces too
    assert.equal(call("question-list", ctxB, {}).result.count, 0);
    assert.equal(call("question-detail", ctxB, { id: q.id }).ok, false);
  });
});
