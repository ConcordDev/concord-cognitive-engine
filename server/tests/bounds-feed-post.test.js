// GB-1539 bounds enforcement — FIX-feed-008 (composer body).
// The walk: the composer accepted 301 characters with no counter or
// maxlength (nothing was posted). The policy class for a feed post is
// 5,000: social.createPost used to clip silently at 2,000 — now an
// over-limit post refuses with invalid_input naming the limit, an
// in-policy post stores whole, and feed.thread-add answers in the
// same policy shape (its local 4,000 cap retired).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocialActions from "../domains/social.js";
import registerFeedActions from "../domains/feed.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSocialActions(register); registerFeedActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_feed_a" }, userId: "bnd_feed_a" };

describe("feed post bounds (FIX-feed-008)", () => {
  it("a 5001-character post refuses with invalid_input naming 5000", () => {
    const r = call("social", "createPost", ctxA, { body: "x".repeat(5001) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /5000 characters/);
  });

  it("a 3000-character post stores whole (no silent clip at 2000)", () => {
    const r = call("social", "createPost", ctxA, { body: "y".repeat(3000) });
    assert.equal(r.ok, true);
    assert.equal(r.result.post.body.length, 3000);
  });

  it("an ordinary post works", () => {
    const r = call("social", "createPost", ctxA, { body: "hello concord" });
    assert.equal(r.ok, true);
  });

  it("a poll question over the title limit refuses", () => {
    const r = call("social", "createPost", ctxA, {
      body: "poll",
      poll: { question: "q".repeat(300), options: ["a", "b"] },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("thread-add refuses a 5001-character body in the policy shape", () => {
    const r = call("feed", "thread-add", ctxA, { body: "z".repeat(5001) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("thread-add accepts a 4500-character body (the retired 4000 cap no longer refuses it)", () => {
    const r = call("feed", "thread-add", ctxA, { body: "z".repeat(4500) });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.body.length, 4500);
  });
});
