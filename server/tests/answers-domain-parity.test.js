// Contract tests for the answers (Stack Overflow / Quora 2026-parity)
// Q&A domain in server/domains/answers.js.

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

function ask(ctx = ctxA, over = {}) {
  return call("question-ask", ctx, {
    title: "How do I center a div?",
    body: "I have tried flexbox but it is not working as expected.",
    tags: "css, layout",
    ...over,
  }).result.question;
}

describe("answers.question-ask", () => {
  it("creates a question with parsed tags, scoped per user", () => {
    const q = ask();
    assert.equal(q.tags.length, 2);
    assert.ok(q.tags.includes("css"));
    assert.equal(call("question-list", ctxA, {}).result.count, 1);
    assert.equal(call("question-list", ctxB, {}).result.count, 0);
  });
  it("rejects a too-short title or body", () => {
    assert.equal(call("question-ask", ctxA, { title: "short", body: "also short" }).ok, false);
    assert.equal(call("question-ask", ctxA, { title: "long enough title", body: "tiny" }).ok, false);
  });
});

describe("answers.question-list filtering & sorting", () => {
  it("filters by tag and unanswered", () => {
    ask(ctxA, { tags: "css" });
    ask(ctxA, { title: "What is a closure?", body: "Explain JS closures clearly please.", tags: "javascript" });
    assert.equal(call("question-list", ctxA, { tag: "javascript" }).result.count, 1);
    assert.equal(call("question-list", ctxA, { filter: "unanswered" }).result.count, 2);
  });
  it("detail increments views and returns accepted answer first", () => {
    const q = ask();
    call("answer-post", ctxA, { questionId: q.id, body: "Use display:flex on the parent element." });
    const acc = call("answer-post", ctxA, { questionId: q.id, body: "Use margin:auto with a fixed width." }).result.answer;
    call("answer-accept", ctxA, { questionId: q.id, answerId: acc.id });
    const d = call("question-detail", ctxA, { id: q.id });
    assert.equal(d.result.question.views, 1);
    assert.equal(d.result.question.answers[0].id, acc.id);
  });
});

describe("answers.answer + accept reputation", () => {
  it("accepting an answer grants +15 reputation to the answerer", () => {
    const q = ask();
    const a = call("answer-post", ctxA, { questionId: q.id, body: "Center it with place-items:center on a grid." }).result.answer;
    const acc = call("answer-accept", ctxA, { questionId: q.id, answerId: a.id });
    assert.equal(acc.ok, true);
    assert.equal(acc.result.reputation, 15);
    // toggling off removes it
    const off = call("answer-accept", ctxA, { questionId: q.id, answerId: a.id });
    assert.equal(off.result.acceptedAnswerId, null);
    assert.equal(off.result.reputation, 0);
  });
  it("rejects accepting on a non-existent answer", () => {
    const q = ask();
    assert.equal(call("answer-accept", ctxA, { questionId: q.id, answerId: "nope" }).ok, false);
  });
});

describe("answers.vote reputation", () => {
  it("upvoting an answer grants +10 and is idempotent (toggle)", () => {
    const q = ask();
    const a = call("answer-post", ctxA, { questionId: q.id, body: "Flexbox with justify+align center works." }).result.answer;
    const up = call("vote", ctxA, { targetType: "answer", targetId: a.id, questionId: q.id, direction: "up" });
    assert.equal(up.result.votes, 1);
    assert.equal(up.result.reputation, 10);
    const undo = call("vote", ctxA, { targetType: "answer", targetId: a.id, questionId: q.id, direction: "up" });
    assert.equal(undo.result.votes, 0);
    assert.equal(undo.result.reputation, 0);
  });
  it("upvoting a question grants +5", () => {
    const q = ask();
    const up = call("vote", ctxA, { targetType: "question", targetId: q.id, direction: "up" });
    assert.equal(up.result.votes, 1);
    assert.equal(up.result.reputation, 5);
  });
});

describe("answers.tags / search / bounty / dashboard", () => {
  it("tag-list aggregates question counts", () => {
    ask(ctxA, { tags: "css" });
    ask(ctxA, { title: "Grid vs flexbox question", body: "When should I prefer grid layout?", tags: "css" });
    const tags = call("tag-list", ctxA, {});
    assert.equal(tags.result.tags[0].tag, "css");
    assert.equal(tags.result.tags[0].questionCount, 2);
  });
  it("search ranks title hits above body hits", () => {
    ask(ctxA, { title: "Centering a div with flexbox", body: "general layout question" });
    const r = call("search", ctxA, { query: "flexbox" });
    assert.ok(r.result.count >= 1);
    assert.equal(r.result.results[0].score >= 5, true);
  });
  it("bounty-start requires enough reputation", () => {
    const q = ask();
    assert.equal(call("bounty-start", ctxA, { questionId: q.id, amount: 100 }).ok, false);
  });
  it("dashboard + user-reputation aggregate the workspace", () => {
    const q = ask();
    call("answer-post", ctxA, { questionId: q.id, body: "An answer body that is long enough." });
    const d = call("dashboard", ctxA, {});
    assert.equal(d.result.questions, 1);
    assert.equal(d.result.totalAnswers, 1);
    const rep = call("user-reputation", ctxA, {});
    assert.equal(rep.result.badge, "newcomer");
    assert.equal(rep.result.answersPosted, 1);
  });
});
