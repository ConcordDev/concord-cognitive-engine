// FIX-repos-004 (server half) — a lens share to the Social Feed creates a
// real, discoverable, deletable post. Pins the social-layer contract the
// publisher relies on:
//  1. createPost with the publisher's payload returns ok + the post id.
//  2. The post appears in the author's own post list (profile surface).
//  3. The author can delete it by id; afterwards it is gone from the list.
//  4. An identical repeat inside the duplicate window is refused with
//     { ok: false } in the body (the route answers HTTP 200, so callers
//     must read ok — the publisher now does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPost, getUserPosts, deletePost } from "../emergent/social-layer.js";

function freshState() {
  const STATE = { dtus: new Map() };
  globalThis._concordSTATE = STATE;
  return STATE;
}

const payload = (userId) => ({
  userId,
  content: "Check this out\n\nrepos repo_1",
  title: "My repo",
  tags: ["repos", "post"],
  mediaType: "post",
  sourceLens: "repos",
  sourceArtifactId: "repo_1",
  visibility: "public",
});

test("publisher share: creates a real post, listed on the profile, deletable by id", async () => {
  const STATE = freshState();
  const created = createPost(STATE, payload("u-share"));
  assert.equal(created.ok, true);
  assert.ok(created.post?.id, "createPost returns the post id");

  const mine = getUserPosts(STATE, "u-share", { viewerId: "u-share" });
  assert.equal(mine.total, 1);
  assert.equal(mine.posts[0].id, created.post.id);

  const del = deletePost(STATE, { userId: "u-share", postId: created.post.id });
  assert.equal(del.ok, true);
  assert.equal(getUserPosts(STATE, "u-share", { viewerId: "u-share" }).total, 0);
});

test("publisher share: an identical repeat is refused in the body (ok:false)", async () => {
  const STATE = freshState();
  const first = createPost(STATE, payload("u-dup"));
  assert.equal(first.ok, true);
  const second = createPost(STATE, payload("u-dup"));
  assert.equal(second.ok, false);
  assert.match(second.error, /duplicate/);
});
