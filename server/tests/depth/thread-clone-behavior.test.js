// Behavior tests for thread.thread-clone — Wave-4 gap closure (see
// docs/WAVE4_INVENTORY.md row 318 / docs/lens-specs/thread-capability-map.md
// "Investigated and honestly deferred" > "No cross-artifact 'duplicate this
// thread' / clone feature"). Whole-thread clone was a small ENGINEERING
// follow-up with no external data dependency; this pins its contract.
//
// thread.js is a pure per-user STATE-backed domain (no DB access at all —
// see getThreadState() in server/domains/thread.js), so this file follows
// the same lightweight self-contained harness as the pre-existing sibling
// server/tests/thread-domain-parity.test.js rather than the full
// server/tests/depth/_harness.js boot (there is nothing DB-shaped to
// exercise). Run in isolation with an isolated DB_PATH per the project's
// standard test invocation even though this suite never touches SQLite.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerThreadActions from "../../domains/thread.js";

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

describe("thread.thread-clone — registration", () => {
  it("is registered", () => {
    assert.ok(ACTIONS.has("thread.thread-clone"));
  });
});

describe("thread.thread-clone — not found / isolation", () => {
  it("rejects a bogus threadId", () => {
    const r = call("thread-clone", ctxA, { id: "th_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "draft not found");
  });
  it("accepts either `id` or `threadId` as the source key", () => {
    const src = call("thread-draft", ctxA, { content: "clone-by-threadId source" }).result.draft;
    const r = call("thread-clone", ctxA, { threadId: src.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.draft.clonedFromId, src.id);
  });
  it("user B cannot clone user A's thread — per-user isolation", () => {
    const src = call("thread-draft", ctxA, { content: "private to user A" }).result.draft;
    const r = call("thread-clone", ctxB, { id: src.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "draft not found");
    // and B's own list stays empty
    assert.equal(call("draft-list", ctxB, {}).result.count, 0);
  });
});

describe("thread.thread-clone — creates an independent new record", () => {
  it("clone gets a new id, distinct from the source", () => {
    const src = call("thread-draft", ctxA, { content: "original content here" }).result.draft;
    const r = call("thread-clone", ctxA, { id: src.id });
    assert.equal(r.ok, true);
    assert.notEqual(r.result.draft.id, src.id);
  });
  it("clone is pushed into the actor's own draft list (count grows by 1)", () => {
    const src = call("thread-draft", ctxA, { content: "count me" }).result.draft;
    assert.equal(call("draft-list", ctxA, {}).result.count, 1);
    call("thread-clone", ctxA, { id: src.id });
    assert.equal(call("draft-list", ctxA, {}).result.count, 2);
  });
  it("clone stamps clonedFromId with the source id, exposed on draft-list too", () => {
    const src = call("thread-draft", ctxA, { content: "provenance source" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.clonedFromId, src.id);
    const listed = call("draft-list", ctxA, {}).result.drafts.find((d) => d.id === clone.id);
    assert.equal(listed.clonedFromId, src.id);
    // The original's own draft-list entry has no clonedFromId (it wasn't cloned FROM anything).
    const srcListed = call("draft-list", ctxA, {}).result.drafts.find((d) => d.id === src.id);
    assert.equal(srcListed.clonedFromId, null);
  });
});

describe("thread.thread-clone — deep-copies content exactly", () => {
  it("copies content, platform, and posts array exactly", () => {
    const long = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} of the original thread body.`).join(" ");
    const src = call("thread-draft", ctxA, { content: long, platform: "linkedin" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.content, src.content);
    assert.equal(clone.platform, src.platform);
    assert.equal(clone.posts.length, src.posts.length);
    for (let i = 0; i < src.posts.length; i++) {
      assert.equal(clone.posts[i].text, src.posts[i].text);
      assert.equal(clone.posts[i].chars, src.posts[i].chars);
    }
  });
  it("copies autoPlug forward", () => {
    const src = call("thread-draft", ctxA, { content: "with autoplug", autoPlug: "check my site" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.autoPlug, "check my site");
  });
});

describe("thread.thread-clone — media references carry forward", () => {
  it("clone carries media references forward with independent (new) media ids", () => {
    const src = call("thread-draft", ctxA, { content: "media source thread" }).result.draft;
    const m1 = call("media-attach", ctxA, { draftId: src.id, postIndex: 1, url: "https://x/a.png", kind: "image" }).result.media;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.media.length, 1);
    assert.equal(clone.media[0].url, m1.url);
    assert.equal(clone.media[0].kind, m1.kind);
    // New, independent id — not a reference to the source's media record.
    assert.notEqual(clone.media[0].id, m1.id);
  });
  it("clone with no media has an empty media array, not undefined", () => {
    const src = call("thread-draft", ctxA, { content: "no media here" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.ok(Array.isArray(clone.media));
    assert.equal(clone.media.length, 0);
  });
  it("removing media from the CLONE does not remove it from the ORIGINAL", () => {
    const src = call("thread-draft", ctxA, { content: "media independence source" }).result.draft;
    call("media-attach", ctxA, { draftId: src.id, postIndex: 1, url: "https://x/a.png" });
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    const cloneMediaId = call("media-list", ctxA, { draftId: clone.id }).result.media[0].id;
    call("media-remove", ctxA, { draftId: clone.id, mediaId: cloneMediaId });
    assert.equal(call("media-list", ctxA, { draftId: clone.id }).result.count, 0);
    assert.equal(call("media-list", ctxA, { draftId: src.id }).result.count, 1);
  });
});

describe("thread.thread-clone — mutation independence (the core clone promise)", () => {
  it("editing the clone after creation does not affect the original", () => {
    const src = call("thread-draft", ctxA, { content: "original body untouched" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    call("draft-update", ctxA, { id: clone.id, content: "mutated clone body only" });
    const srcAfter = call("draft-detail", ctxA, { id: src.id }).result.draft;
    const cloneAfter = call("draft-detail", ctxA, { id: clone.id }).result.draft;
    assert.equal(srcAfter.content, "original body untouched");
    assert.equal(cloneAfter.content, "mutated clone body only");
  });
  it("editing the original after cloning does not affect the clone", () => {
    const src = call("thread-draft", ctxA, { content: "will be edited after clone" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    call("draft-update", ctxA, { id: src.id, content: "original mutated post-clone" });
    const srcAfter = call("draft-detail", ctxA, { id: src.id }).result.draft;
    const cloneAfter = call("draft-detail", ctxA, { id: clone.id }).result.draft;
    assert.equal(srcAfter.content, "original mutated post-clone");
    assert.equal(cloneAfter.content, "will be edited after clone");
  });
  it("deleting the clone does not delete the original, and vice versa", () => {
    const src = call("thread-draft", ctxA, { content: "delete independence source" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    call("draft-delete", ctxA, { id: clone.id });
    assert.equal(call("draft-detail", ctxA, { id: src.id }).ok, true);
    assert.equal(call("draft-detail", ctxA, { id: clone.id }).ok, false);
  });
});

describe("thread.thread-clone — naming convention", () => {
  it("defaults to '<title> (copy)' when no override is given", () => {
    const src = call("thread-draft", ctxA, { content: "Named thread", title: "My Great Thread" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.title, "My Great Thread (copy)");
  });
  it("honors an explicit newTitle override", () => {
    const src = call("thread-draft", ctxA, { content: "Named thread again", title: "Original Title" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id, newTitle: "Totally Different Title" }).result.draft;
    assert.equal(clone.title, "Totally Different Title");
  });
  it("honors `name` as an alias for newTitle", () => {
    const src = call("thread-draft", ctxA, { content: "aliasing test", title: "T" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id, name: "Via Name Param" }).result.draft;
    assert.equal(clone.title, "Via Name Param");
  });
});

describe("thread.thread-clone — status default is honest, not copied blindly", () => {
  it("cloning a DRAFT stays a draft", () => {
    const src = call("thread-draft", ctxA, { content: "still a draft" }).result.draft;
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.status, "draft");
  });
  it("cloning a SCHEDULED thread resets the clone to draft with no scheduledAt", () => {
    const src = call("thread-draft", ctxA, { content: "scheduled source" }).result.draft;
    call("draft-schedule", ctxA, { id: src.id, scheduledAt: "2099-06-01T09:00:00Z" });
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.status, "draft");
    assert.equal(clone.scheduledAt, null);
    // The original keeps its own scheduled state — clone didn't mutate it.
    assert.equal(call("draft-detail", ctxA, { id: src.id }).result.draft.status, "scheduled");
  });
  it("cloning a PUBLISHED thread resets the clone to draft (edit-and-repost is the point)", () => {
    const src = call("thread-draft", ctxA, { content: "published source" }).result.draft;
    call("draft-publish", ctxA, { id: src.id });
    const clone = call("thread-clone", ctxA, { id: src.id }).result.draft;
    assert.equal(clone.status, "draft");
    // The original stays published — clone didn't mutate it.
    assert.equal(call("draft-detail", ctxA, { id: src.id }).result.draft.status, "published");
  });
});
