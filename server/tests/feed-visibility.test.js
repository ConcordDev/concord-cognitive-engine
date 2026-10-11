/**
 * Feed audience: public posts are on Explore for everyone and on Following
 * once the viewer follows the author. Private posts stay hidden on both
 * lists and on by-id reads. Unset / federation `local` stays public on
 * this instance so existing posts keep showing up.
 *
 * Run: node --test tests/feed-visibility.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createPost,
  followUser,
  getComments,
  getExploreFeed,
  getFollowingFeed,
  getPost,
  upsertProfile,
} from "../emergent/social-layer.js";

function world() {
  const STATE = {};
  upsertProfile(STATE, "A", { displayName: "Account A" });
  upsertProfile(STATE, "B", { displayName: "Account B" });
  return STATE;
}

function ids(feed) {
  return (feed.posts || []).map((p) => p.id);
}

describe("social feed visibility", () => {
  it("shows A's public post on B's Explore, and on Following only after B follows A", () => {
    const STATE = world();
    const created = createPost(STATE, { userId: "A", content: "public hello from A", privacy: "public" });
    assert.equal(created.ok, true);
    const id = created.post.id;

    const explore = getExploreFeed(STATE, {});
    assert.ok(ids(explore).includes(id), "public post must be in Explore");
    assert.equal(explore.posts.find((p) => p.id === id).content, "public hello from A");
    assert.equal(explore.posts.find((p) => p.id === id).privacy, "public");

    const before = getFollowingFeed(STATE, "B", {});
    assert.equal(ids(before).includes(id), false, "Following is empty until B follows A");

    const followed = followUser(STATE, "B", "A");
    assert.equal(followed.ok, true);
    const after = getFollowingFeed(STATE, "B", {});
    assert.ok(ids(after).includes(id), "Following includes A's public post once B follows A");
  });

  it("hides a private post from B's Explore, Following, and by-id read", () => {
    const STATE = world();
    followUser(STATE, "B", "A");
    const created = createPost(STATE, { userId: "A", content: "secret note", privacy: "private" });
    assert.equal(created.ok, true);
    const id = created.post.id;

    assert.equal(ids(getExploreFeed(STATE, {})).includes(id), false);
    assert.equal(
      getExploreFeed(STATE, {}).posts.some((p) => p.content === "secret note"),
      false,
    );
    assert.equal(ids(getFollowingFeed(STATE, "B", {})).includes(id), false);

    const asB = getPost(STATE, id, "B");
    assert.equal(asB.ok, false);
    assert.equal(asB.error, "Post not found");
    assert.equal(getComments(STATE, id, { viewerId: "B" }).ok, false);

    const asA = getPost(STATE, id, "A");
    assert.equal(asA.ok, true);
    assert.equal(asA.post.content, "secret note");
    assert.equal(ids(getExploreFeed(STATE, {})).includes(id), false, "Explore stays public even for the author");
  });

  it("keeps an unset or local post public on this instance", () => {
    const STATE = world();
    const created = createPost(STATE, { userId: "A", content: "legacy local" });
    assert.equal(created.post.privacy, "public");
    assert.equal(created.post.federationVisibility, "local");
    assert.ok(ids(getExploreFeed(STATE, {})).includes(created.post.id));
    assert.equal(getPost(STATE, created.post.id, "B").ok, true);
  });
});
