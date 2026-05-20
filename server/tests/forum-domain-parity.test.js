// Contract tests for the forum Discourse + Reddit 2026-parity
// community lens (categories, topics, replies, voting, moderation
// flags, reputation tiers, search).

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

describe("forum.category-*", () => {
  it("creates, lists with topic counts and deletes", () => {
    const cat = call("category-create", ctxA, { name: "General" }).result.category;
    call("topic-create", ctxA, { categoryId: cat.id, title: "Hello" });
    const list = call("category-list", ctxA, {});
    assert.equal(list.result.categories[0].topicCount, 1);
    call("category-delete", ctxA, { id: cat.id });
    assert.equal(call("category-list", ctxA, {}).result.count, 0);
  });

  it("isolates categories per user", () => {
    call("category-create", ctxA, { name: "X" });
    assert.equal(call("category-list", ctxB, {}).result.count, 0);
  });
});

describe("forum topics & replies", () => {
  it("creates topics, replies and returns the thread", () => {
    const t = call("topic-create", ctxA, { title: "Question", body: "How?", tags: ["help", "Help"] }).result.topic;
    assert.deepEqual(t.tags, ["help"]);
    call("post-reply", ctxA, { topicId: t.id, body: "Answer one" });
    call("post-reply", ctxA, { topicId: t.id, body: "Answer two" });
    const got = call("topic-get", ctxA, { id: t.id });
    assert.equal(got.result.replyCount, 2);
  });

  it("locks a topic and blocks replies", () => {
    const t = call("topic-create", ctxA, { title: "Closed" }).result.topic;
    call("topic-lock", ctxA, { id: t.id, locked: true });
    assert.equal(call("post-reply", ctxA, { topicId: t.id, body: "late" }).ok, false);
  });

  it("pins topics to the top of the list", () => {
    const t1 = call("topic-create", ctxA, { title: "Normal" }).result.topic;
    const t2 = call("topic-create", ctxA, { title: "Important" }).result.topic;
    call("topic-pin", ctxA, { id: t2.id, pinned: true });
    const list = call("topic-list", ctxA, {});
    assert.equal(list.result.topics[0].id, t2.id);
    assert.ok(t1);
  });

  it("deletes a topic and its replies", () => {
    const t = call("topic-create", ctxA, { title: "Temp" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "x" });
    call("topic-delete", ctxA, { id: t.id });
    assert.equal(call("topic-list", ctxA, {}).result.count, 0);
  });
});

describe("forum voting", () => {
  it("votes on a topic and updates the score", () => {
    const t = call("topic-create", ctxA, { title: "Voted" }).result.topic;
    const up = call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 1 });
    assert.equal(up.result.score, 1);
    const clear = call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 0 });
    assert.equal(clear.result.score, 0);
  });

  it("sorts topics by top score", () => {
    const t1 = call("topic-create", ctxA, { title: "Low" }).result.topic;
    const t2 = call("topic-create", ctxA, { title: "High" }).result.topic;
    call("vote", ctxA, { targetType: "topic", targetId: t2.id, direction: 1 });
    const list = call("topic-list", ctxA, { sort: "top" });
    assert.equal(list.result.topics[0].id, t2.id);
    assert.ok(t1);
  });
});

describe("forum moderation", () => {
  it("creates flags, queues them and resolves", () => {
    const t = call("topic-create", ctxA, { title: "Reported" }).result.topic;
    const flag = call("flag-create", ctxA, { targetType: "topic", targetId: t.id, reason: "spam" }).result.flag;
    assert.equal(call("flag-queue", ctxA, {}).result.pendingCount, 1);
    call("flag-resolve", ctxA, { id: flag.id, action: "content_removed" });
    const q = call("flag-queue", ctxA, {});
    assert.equal(q.result.pendingCount, 0);
    assert.equal(q.result.resolvedCount, 1);
  });
});

describe("forum reputation & search", () => {
  it("computes a trust tier from contributions", () => {
    for (let i = 0; i < 6; i++) call("topic-create", ctxA, { title: `T${i}` });
    const rep = call("user-reputation", ctxA, {});
    assert.equal(rep.result.tier, "basic");
    assert.equal(rep.result.contributions, 6);
  });

  it("searches topic titles, bodies and replies", () => {
    const t = call("topic-create", ctxA, { title: "Recipe ideas", body: "share your best" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "pasta is great" });
    assert.equal(call("forum-search", ctxA, { query: "recipe" }).result.topicHits, 1);
    assert.equal(call("forum-search", ctxA, { query: "pasta" }).result.matchingReplies, 1);
  });

  it("dashboard rolls up the community", () => {
    call("category-create", ctxA, { name: "C" });
    const t = call("topic-create", ctxA, { title: "T" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "r" });
    const d = call("forum-dashboard", ctxA, {});
    assert.equal(d.result.categories, 1);
    assert.equal(d.result.topics, 1);
    assert.equal(d.result.replies, 1);
  });
});
