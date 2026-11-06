// Contract tests for the forum full lens build (F-B row 2): the
// lifecycle verbs (D1), the body floor (D7/F8), and the self-vote
// refusal (D5/F5) — against R4's first pass (2026-10-31, F1–F8).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForumActions from "../domains/forum.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`forum.${name}`);
  assert.ok(fn, `forum.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerForumActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("forum full build — D7 body floor (F8)", () => {
  it("a titled topic with an empty body is refused, naming the floor", () => {
    const r = call("topic-create", ctxA, { title: "Title only" });
    assert.equal(r.ok, false);
    assert.match(r.error, /topic body required/);
    const blank = call("topic-create", ctxA, { title: "Blank", body: "   " });
    assert.equal(blank.ok, false);
    assert.equal(call("topic-list", ctxA, {}).result.count, 0);
  });
});

describe("forum full build — D1 lifecycle (F1)", () => {
  it("topic-edit moves the body, keeps the title, and records the revision", () => {
    const t = call("topic-create", ctxA, { title: "Original title", body: "first version" }).result.topic;
    const edited = call("topic-edit", ctxA, { id: t.id, body: "second version", title: "Retitled attempt" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.topic.title, "Original title");
    assert.equal(edited.result.topic.body, "second version");
    assert.ok(edited.result.topic.editedAt);
    assert.equal(edited.result.topic.revisions.length, 1);
    assert.equal(edited.result.topic.revisions[0].body, "first version");
    const again = call("topic-edit", ctxA, { id: t.id, body: "third version" });
    assert.equal(again.result.topic.revisions.length, 2);
    assert.equal(again.result.topic.revisions[1].body, "second version");
  });

  it("only the author edits a topic; an empty edit body is refused", () => {
    const t = call("topic-create", ctxA, { title: "Mine", body: "text" }).result.topic;
    assert.match(call("topic-edit", ctxB, { id: t.id, body: "hijack" }).error, /only the author/);
    assert.match(call("topic-edit", ctxA, { id: t.id, body: " " }).error, /topic body required/);
    assert.equal(call("topic-get", ctxA, { id: t.id }).result.topic.body, "text");
  });

  it("post-edit rewrites a reply with the same audit shape; post-delete removes it", () => {
    const t = call("topic-create", ctxA, { title: "Thread", body: "op" }).result.topic;
    const p = call("post-reply", ctxB, { topicId: t.id, body: "frist draft" }).result.post;
    const edited = call("post-edit", ctxB, { id: p.id, body: "first draft, fixed" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.post.body, "first draft, fixed");
    assert.equal(edited.result.post.revisions[0].body, "frist draft");
    assert.match(call("post-edit", ctxA, { id: p.id, body: "not yours" }).error, /only the author/);
    assert.equal(call("post-delete", ctxB, { id: p.id }).ok, true);
    assert.equal(call("topic-get", ctxA, { id: t.id }).result.replyCount, 0);
  });
});

describe("forum full build — D5 self-vote refusal (F5)", () => {
  it("the author cannot vote on their own topic or reply; other readers can", () => {
    const t = call("topic-create", ctxA, { title: "Standing", body: "text" }).result.topic;
    const selfTopic = call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 1 });
    assert.equal(selfTopic.ok, false);
    assert.match(selfTopic.error, /cannot vote on your own/);
    const p = call("post-reply", ctxA, { topicId: t.id, body: "mine too" }).result.post;
    assert.equal(call("vote", ctxA, { targetType: "post", targetId: p.id, direction: 1 }).ok, false);
    assert.equal(call("vote", ctxB, { targetType: "topic", targetId: t.id, direction: 1 }).result.score, 1);
    assert.equal(call("vote", ctxB, { targetType: "post", targetId: p.id, direction: 1 }).result.score, 1);
    // Karma counts only the received votes.
    assert.equal(call("user-reputation", ctxA, {}).result.karma, 2);
  });
});
