// A Timeline post the viewer keeps is a real forum topic or thread draft.
// The draft stays a draft. Nothing here publishes to an external network.

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

describe("timeline post keep", () => {
  it("stores a forum topic whose body cites the timeline post", () => {
    const created = call("timeline.post-create", ctx, { content: "Harbor lights at dusk.", privacy: "public" });
    const post = created.result.post;
    const body = `Source: Concord Timeline post ${post.id} by user_a (public).\n\nHarbor lights at dusk.`;
    const topic = call("forum.topic-create", ctx, { title: "Harbor lights at dusk.", body, format: "plain", tags: ["timeline"] });
    assert.equal(topic.ok, true);
    const got = call("forum.topic-get", ctx, { id: topic.result.topic.id });
    assert.match(got.result.topic.body, new RegExp(`Source: Concord Timeline post ${post.id}`));
  });

  it("stores a thread draft and leaves it unposted", () => {
    const created = call("timeline.post-create", ctx, { content: "Harbor lights at dusk.", privacy: "private" });
    const post = created.result.post;
    const draft = call("thread.thread-draft", ctx, {
      title: "Harbor lights at dusk.",
      content: `Source: Concord Timeline post ${post.id} by user_a (private).\n\nHarbor lights at dusk.`,
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.result.draft.status, "draft");
    const got = call("thread.draft-detail", ctx, { id: draft.result.draft.id });
    assert.equal(got.result.draft.status, "draft");
    assert.match(got.result.draft.content, /Harbor lights at dusk/);
  });
});
