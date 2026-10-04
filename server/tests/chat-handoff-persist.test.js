// Chat transcript handoff — the destinations the chat menu calls.
// These domains persist in process STATE. A post, topic, or draft counts
// only when a later read returns the same id. Nothing here publishes to
// an external network.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTimelineActions from "../domains/timeline.js";
import registerForumActions from "../domains/forum.js";
import registerThreadActions from "../domains/thread.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(key, ctx, params = {}) {
  const fn = ACTIONS.get(key);
  assert.ok(fn, `${key} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerTimelineActions(register);
  registerForumActions(register);
  registerThreadActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };
const transcript = "Source: Concord chat sess-1.\n\nYou: How do tides work?\n\nConcord: The moon pulls the oceans.";

describe("chat handoff persistence", () => {
  it("stores a private Timeline post the author can read back", () => {
    const created = call("timeline.post-create", ctx, { content: transcript, privacy: "private", media: [] });
    assert.equal(created.ok, true);
    const id = created.result.post.id;
    assert.equal(created.result.post.privacy, "private");
    const feed = call("timeline.feed-list", ctx, { authorId: "user_a" });
    const found = feed.result.posts.find((p) => p.id === id);
    assert.ok(found, "author feed includes the new post");
    assert.match(found.content, /Source: Concord chat sess-1/);
    assert.equal(found.privacy, "private");
  });

  it("refuses an empty Timeline post", () => {
    const created = call("timeline.post-create", ctx, { content: "   ", privacy: "public", media: [] });
    assert.equal(created.ok, false);
    assert.equal(created.result, undefined);
  });

  it("stores a forum topic and reads it back by id", () => {
    const created = call("forum.topic-create", ctx, {
      title: "Tides",
      body: transcript,
      format: "plain",
      tags: ["chat"],
    });
    assert.equal(created.ok, true);
    const id = created.result.topic.id;
    const got = call("forum.topic-get", ctx, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.topic.title, "Tides");
    assert.match(got.result.topic.body, /Source: Concord chat sess-1/);
  });

  it("stores a thread draft and leaves it unposted", () => {
    const created = call("thread.thread-draft", ctx, { title: "Tides", content: transcript });
    assert.equal(created.ok, true);
    assert.equal(created.result.draft.status, "draft");
    const id = created.result.draft.id;
    const got = call("thread.draft-detail", ctx, { id });
    assert.equal(got.result.draft.status, "draft");
    assert.match(got.result.draft.content, /Source: Concord chat sess-1/);
  });
});
