// FIX-social-001 — the author can delete their own reply/comment.
// Pins for social.deleteReply:
//  1. The author deletes their reply; it leaves the tree.
//  2. A child of the deleted reply is re-attached to the deleted reply's
//     parent (thread structure survives; nobody else's words are removed).
//  3. A non-author is refused and the reply stands.
//  4. An unknown reply id is refused.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocialActions from "../domains/social.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`social.${name}`);
  assert.ok(fn, `social.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSocialActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

function threadedPost() {
  const post = call("createPost", ctxA, { body: "host post" }).result.post;
  const r1 = call("addReply", ctxB, { postId: post.id, body: "parent reply" }).result.reply;
  const r2 = call("addReply", ctxC, { postId: post.id, body: "child reply", parentId: r1.id }).result.reply;
  return { post, r1, r2 };
}

describe("social.deleteReply", () => {
  it("author deletes; the child re-attaches to the deleted reply's parent", () => {
    const { post, r1, r2 } = threadedPost();
    const del = call("deleteReply", ctxB, { postId: post.id, replyId: r1.id });
    assert.equal(del.ok, true);
    const tree = call("replyTree", ctxA, { postId: post.id });
    assert.equal(tree.result.total, 1);
    assert.equal(tree.result.tree.length, 1);
    assert.equal(tree.result.tree[0].id, r2.id);
    assert.equal(tree.result.tree[0].body, "child reply");
  });

  it("a non-author is refused and the reply stands", () => {
    const { post, r1 } = threadedPost();
    const del = call("deleteReply", ctxC, { postId: post.id, replyId: r1.id });
    assert.equal(del.ok, false);
    assert.match(del.error, /only the author/);
    assert.equal(call("replyTree", ctxA, { postId: post.id }).result.total, 2);
  });

  it("an unknown reply id is refused", () => {
    const { post } = threadedPost();
    const del = call("deleteReply", ctxB, { postId: post.id, replyId: "reply_nope" });
    assert.equal(del.ok, false);
    assert.match(del.error, /not found/);
  });
});
