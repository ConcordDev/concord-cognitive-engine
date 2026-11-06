// Full-build pins for build(answers) — S1 (soft delete + restore),
// S2 (the bounty threshold/amount split), S3 (Follow state in the list).
// Harness mirrors answers-domain-parity.test.js.

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

function ask(over = {}) {
  return call("question-ask", ctxA, {
    title: "How do I center a div?",
    body: "I have tried flexbox but it is not working as expected.",
    tags: "css, layout",
    ...over,
  }).result.question;
}
function seedRep(n) {
  call("dashboard", ctxA, {});
  globalThis._concordSTATE.answersLens.reputation.set("user_a", n);
}

describe("S1 — question delete is soft and reversible", () => {
  it("delete removes the question from list/detail/search; restore brings it back", () => {
    const q = ask();
    const del = call("question-delete", ctxA, { id: q.id });
    assert.equal(del.ok, true);
    assert.ok(del.result.deletedAt);
    assert.equal(call("question-list", ctxA, {}).result.count, 0);
    assert.equal(call("question-detail", ctxA, { id: q.id }).ok, false);
    assert.equal(call("search", ctxA, { query: "center" }).result.count, 0);
    assert.equal(call("dashboard", ctxA, {}).result.questions, 0);
    // a second delete is an honest refusal, not a silent success
    assert.equal(call("question-delete", ctxA, { id: q.id }).ok, false);
    const back = call("question-restore", ctxA, { id: q.id });
    assert.equal(back.ok, true);
    assert.equal(call("question-list", ctxA, {}).result.count, 1);
    assert.equal(call("question-detail", ctxA, { id: q.id }).ok, true);
    // restoring a live question refuses too
    assert.equal(call("question-restore", ctxA, { id: q.id }).ok, false);
  });
});

describe("S1 — answer delete is soft, clears acceptance, restores", () => {
  it("a deleted answer leaves the detail and the counts; restore returns it", () => {
    const q = ask();
    const a = call("answer-post", ctxA, { questionId: q.id, body: "Use display:flex on the parent element." }).result.answer;
    call("answer-accept", ctxA, { questionId: q.id, answerId: a.id });
    const del = call("answer-delete", ctxA, { questionId: q.id, answerId: a.id });
    assert.equal(del.ok, true);
    const d = call("question-detail", ctxA, { id: q.id });
    assert.equal(d.result.question.answers.length, 0);
    assert.equal(d.result.question.acceptedAnswerId, null);
    assert.equal(call("question-list", ctxA, {}).result.questions[0].answerCount, 0);
    const back = call("answer-restore", ctxA, { questionId: q.id, answerId: a.id });
    assert.equal(back.ok, true);
    const d2 = call("question-detail", ctxA, { id: q.id });
    assert.equal(d2.result.question.answers.length, 1);
    // restore does not resurrect the acceptance
    assert.equal(d2.result.question.acceptedAnswerId, null);
  });
  it("writes against a deleted question refuse as not found", () => {
    const q = ask();
    call("question-delete", ctxA, { id: q.id });
    assert.equal(call("answer-post", ctxA, { questionId: q.id, body: "An answer body that is long enough." }).ok, false);
    assert.equal(call("question-subscribe", ctxA, { questionId: q.id }).ok, false);
  });
});

describe("S2 — the bounty threshold and the amount are separate numbers", () => {
  it("below 75 the refusal names the threshold, whatever the amount", () => {
    const q = ask();
    seedRep(70);
    const r = call("bounty-start", ctxA, { questionId: q.id, amount: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /need 75 reputation to start bounties/);
  });
  it("above the threshold, the amount is a balance check with its own refusal", () => {
    const q = ask();
    seedRep(80);
    const r = call("bounty-start", ctxA, { questionId: q.id, amount: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error, /costs 100 reputation/);
  });
  it("a funded bounty posts: the amount is spent, the question carries it", () => {
    const q = ask();
    seedRep(150);
    const r = call("bounty-start", ctxA, { questionId: q.id, amount: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bounty, 100);
    assert.equal(r.result.reputation, 50);
  });
});

describe("S3 — Follow state rides the list", () => {
  it("question-list summaries carry the actor's subscribed flag", () => {
    const q = ask();
    assert.equal(call("question-list", ctxA, {}).result.questions[0].subscribed, false);
    call("question-subscribe", ctxA, { questionId: q.id });
    assert.equal(call("question-list", ctxA, {}).result.questions[0].subscribed, true);
    call("question-subscribe", ctxA, { questionId: q.id });
    assert.equal(call("question-list", ctxA, {}).result.questions[0].subscribed, false);
  });
});
