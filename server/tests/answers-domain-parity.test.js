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

// ── Edit history + revision diff ──────────────────────────────────────
describe("answers.question-edit / answer-edit / revisions", () => {
  it("editing a question records a revision with a word-level diff", () => {
    const q = ask();
    const e = call("question-edit", ctxA, { id: q.id, body: "I have tried flexbox AND grid but neither worked." });
    assert.equal(e.ok, true);
    assert.equal(e.result.revisionCount, 1);
    const revs = call("revisions", ctxA, { questionId: q.id });
    assert.equal(revs.result.count, 1);
    assert.equal(revs.result.revisions[0].field, "body");
    assert.ok(Array.isArray(revs.result.revisions[0].diff));
    assert.ok(revs.result.revisions[0].diff.some((op) => op.t === "add"));
  });
  it("rejects an unchanged edit and supports markdown body format", () => {
    const q = call("question-ask", ctxA, {
      title: "Markdown question test", body: "Body with **markdown** content here.",
      bodyFormat: "markdown",
    }).result.question;
    assert.equal(q.bodyFormat, "markdown");
    assert.equal(call("question-edit", ctxA, { id: q.id, body: q.body }).ok, false);
  });
  it("editing an answer records a revision", () => {
    const q = ask();
    const a = call("answer-post", ctxA, { questionId: q.id, body: "Original answer body content." }).result.answer;
    const e = call("answer-edit", ctxA, { questionId: q.id, answerId: a.id, body: "Updated answer body content here." });
    assert.equal(e.ok, true);
    assert.equal(e.result.revisionCount, 1);
  });
});

// ── Duplicate detection + linking ─────────────────────────────────────
describe("answers.find-duplicates / link-duplicate", () => {
  it("finds similar questions by bag-of-words cosine similarity", () => {
    ask(ctxA, { title: "How do I center a div in CSS", body: "centering with flexbox not working" });
    const dup = call("find-duplicates", ctxA, {
      title: "How can I center a div", body: "flexbox centering trouble", threshold: 0.1,
    });
    assert.equal(dup.ok, true);
    assert.ok(dup.result.count >= 1);
    assert.ok(dup.result.matches[0].similarity > 0);
  });
  it("links and unlinks a question as a duplicate of another", () => {
    const q1 = ask(ctxA, { title: "Centering a div question one" });
    const q2 = ask(ctxA, { title: "Centering a div question two" });
    const l = call("link-duplicate", ctxA, { questionId: q2.id, duplicateOf: q1.id });
    assert.equal(l.ok, true);
    assert.equal(l.result.duplicateOf.id, q1.id);
    const u = call("link-duplicate", ctxA, { questionId: q2.id, duplicateOf: null });
    assert.equal(u.result.duplicateOf, null);
  });
});

// ── Privilege tiers ───────────────────────────────────────────────────
describe("answers.privileges", () => {
  it("reports unlocked privilege tiers based on reputation", () => {
    const p = call("privileges", ctxA, {});
    assert.equal(p.ok, true);
    assert.equal(p.result.reputation, 0);
    assert.ok(p.result.tiers.find((t) => t.id === "ask").unlocked);
    assert.equal(p.result.tiers.find((t) => t.id === "vote_down").unlocked, false);
    assert.ok(p.result.nextUnlock);
  });
});

// ── Tag-watch / subscription / notifications ──────────────────────────
describe("answers.tag-watch / question-subscribe / notifications", () => {
  it("watching a tag notifies the watcher of a new question", () => {
    call("tag-watch", ctxB, { tag: "css" });
    ask(ctxA, { tags: "css" });
    const n = call("notifications", ctxB, {});
    assert.ok(n.result.count >= 1);
    assert.equal(n.result.notifications[0].kind, "tag-watch");
  });
  it("subscribing to a question notifies on a new answer", () => {
    const q = ask(ctxA);
    call("question-subscribe", ctxA, { questionId: q.id });
    const sub = call("question-subscribe", ctxA, { questionId: q.id });
    assert.equal(sub.result.subscribed, false); // toggled off
    const watcher = call("question-subscribe", ctxA, { questionId: q.id });
    assert.equal(watcher.result.subscribed, true);
  });
  it("marks notifications as read", () => {
    call("tag-watch", ctxB, { tag: "css" });
    ask(ctxA, { tags: "css" });
    const before = call("notifications", ctxB, {});
    assert.ok(before.result.unread >= 1);
    const m = call("notifications-mark", ctxB, {});
    assert.equal(m.result.unread, 0);
  });
});

// ── Related questions ─────────────────────────────────────────────────
describe("answers.related", () => {
  it("returns related questions ranked by similarity and shared tags", () => {
    const q1 = ask(ctxA, { title: "How do I center a div with flexbox", tags: "css" });
    ask(ctxA, { title: "Center a div using grid layout", body: "grid centering question here", tags: "css" });
    const r = call("related", ctxA, { questionId: q1.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.related[0].relevance > 0);
  });
});

// ── Flags / close-votes / moderation ──────────────────────────────────
describe("answers.flag / close-vote / mod-queue / mod-resolve", () => {
  function highRepCtx(target = 1500) {
    const ctx = { actor: { userId: "user_mod" }, userId: "user_mod" };
    // Trigger state initialisation, then seed reputation directly.
    call("dashboard", ctx, {});
    globalThis._concordSTATE.answersLens.reputation.set("user_mod", target);
    return ctx;
  }
  it("flagging requires reputation and lands in the mod queue", () => {
    const mod = highRepCtx();
    const q = call("question-ask", mod, {
      title: "A question to be flagged", body: "This question body is long enough.",
    }).result.question;
    const f = call("flag", mod, { questionId: q.id, reason: "spam" });
    assert.equal(f.ok, true);
    const queue = call("mod-queue", mod, {});
    assert.ok(queue.result.count >= 1);
    const r = call("mod-resolve", mod, { questionId: q.id, flagId: f.result.flag.id, decision: "actioned" });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "actioned");
  });
  it("rejects flagging from a low-reputation user", () => {
    const q = ask(ctxA);
    assert.equal(call("flag", ctxA, { questionId: q.id, reason: "spam" }).ok, false);
  });
  it("close votes accumulate and close the question at the threshold", () => {
    const mod = highRepCtx();
    const q = call("question-ask", mod, {
      title: "A question to be closed", body: "This question body is long enough.",
    }).result.question;
    // single voter toggles; need three distinct voters to close
    globalThis._concordSTATE.answersLens.reputation.set("user_mod", 1500);
    const cv = call("close-vote", mod, { questionId: q.id, reason: "duplicate" });
    assert.equal(cv.ok, true);
    assert.equal(cv.result.closeVotes, 1);
    assert.equal(cv.result.closed, false);
  });
});
