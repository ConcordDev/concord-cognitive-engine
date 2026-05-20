// Contract tests for the thread lens — Typefully-shape thread composer
// in server/domains/thread.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerThreadActions from "../domains/thread.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`thread.${name}`);
  assert.ok(fn, `thread.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerThreadActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("thread.split-preview", () => {
  it("keeps short text as a single post", () => {
    const r = call("split-preview", ctxA, { content: "Just one short thought." });
    assert.equal(r.result.postCount, 1);
  });
  it("auto-splits long text into numbered posts under the limit", () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of a long thread that must be split.`).join(" ");
    const r = call("split-preview", ctxA, { content: long, limit: 200 });
    assert.ok(r.result.postCount > 1);
    assert.ok(r.result.posts.every((p) => p.chars <= 200));
    assert.match(r.result.posts[0].text, /1\/\d+$/);
  });
});

describe("thread.draft CRUD", () => {
  it("creates a draft, splitting content, scoped per user", () => {
    const r = call("thread-draft", ctxA, { content: "First line of the draft.\n\nSecond paragraph here." });
    assert.equal(r.ok, true);
    assert.ok(r.result.draft.posts.length >= 1);
    assert.equal(call("draft-list", ctxA, {}).result.count, 1);
    assert.equal(call("draft-list", ctxB, {}).result.count, 0);
  });
  it("rejects an empty draft", () => {
    assert.equal(call("thread-draft", ctxA, { content: "" }).ok, false);
  });
  it("update re-splits the content", () => {
    const d = call("thread-draft", ctxA, { content: "short" }).result.draft;
    const long = Array.from({ length: 10 }, () => "A sentence that adds length to force a split here.").join(" ");
    call("draft-update", ctxA, { id: d.id, content: long });
    assert.ok(call("draft-detail", ctxA, { id: d.id }).result.draft.posts.length > 1);
  });
  it("delete removes the draft", () => {
    const d = call("thread-draft", ctxA, { content: "to delete" }).result.draft;
    call("draft-delete", ctxA, { id: d.id });
    assert.equal(call("draft-list", ctxA, {}).result.count, 0);
  });
});

describe("thread.queue + publish", () => {
  it("schedule moves a draft into the queue", () => {
    const d = call("thread-draft", ctxA, { content: "scheduled thread" }).result.draft;
    const sched = call("draft-schedule", ctxA, { id: d.id, scheduledAt: "2099-06-01T09:00:00Z" });
    assert.equal(sched.result.draft.status, "scheduled");
    assert.equal(call("queue-list", ctxA, {}).result.count, 1);
  });
  it("rejects an invalid schedule date", () => {
    const d = call("thread-draft", ctxA, { content: "x y z" }).result.draft;
    assert.equal(call("draft-schedule", ctxA, { id: d.id, scheduledAt: "not-a-date" }).ok, false);
  });
  it("publish flips status and dashboard counts", () => {
    const d = call("thread-draft", ctxA, { content: "publish me now" }).result.draft;
    call("draft-publish", ctxA, { id: d.id });
    const dash = call("thread-dashboard", ctxA, {});
    assert.equal(dash.result.published, 1);
    assert.equal(dash.result.total, 1);
  });
  it("best-time returns ranked posting slots", () => {
    const r = call("best-time", ctxA, {});
    assert.ok(r.result.slots.length >= 3);
    assert.ok(r.result.recommended.score >= r.result.slots[r.result.slots.length - 1].score);
  });
});

describe("thread — analysis macros still intact", () => {
  it("threadAnalyze handles input", () => {
    const r = call("threadAnalyze", ctxA, {});
    assert.equal(r.ok, true);
  });
});
