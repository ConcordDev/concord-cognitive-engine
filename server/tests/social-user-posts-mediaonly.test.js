// FIX-metalearning-012 (server half) — the profile Media tabs pass
// mediaOnly: true to GET /api/social/posts/user/:userId, but
// getUserPosts ignored the flag and returned every post, so a tab
// labelled "media" listed plain text posts too. The layer now honours
// mediaOnly (a post counts as media when mediaList finds a mediaUrl /
// media list on it). The route handlers (routes/social-core.js and the
// server.js inline registration) pass the query flag through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPost, getUserPosts } from "../emergent/social-layer.js";

function freshState() {
  const STATE = { dtus: new Map() };
  globalThis._concordSTATE = STATE;
  return STATE;
}

test("getUserPosts mediaOnly returns only posts carrying media", async () => {
  const STATE = freshState();
  const text = createPost(STATE, { userId: "u-media", content: "just words" });
  assert.equal(text.ok, true);
  const pic = createPost(STATE, { userId: "u-media", content: "look", mediaType: "image", mediaUrl: "https://example.com/x.png" });
  assert.equal(pic.ok, true);

  const all = getUserPosts(STATE, "u-media", { viewerId: "u-media" });
  assert.equal(all.total, 2);

  const media = getUserPosts(STATE, "u-media", { viewerId: "u-media", mediaOnly: true });
  assert.equal(media.total, 1);
  assert.equal(media.posts[0].id, pic.post.id);
});
