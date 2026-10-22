/**
 * Privacy matrix for lens macros that #1440 left open: writes, share
 * targets, polls, stories in the main feed, and public-only trending tags.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSocial,
  createPost,
  followUser,
  upsertProfile,
} from "../emergent/social-layer.js";
import { setUserBlock } from "../lib/social-loop.js";
import registerSocialActions from "../domains/social.js";

function world() {
  const STATE = { dtus: new Map(), socialLens: { moderation: new Map() } };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  for (const id of ["alice", "bob", "cy"]) {
    upsertProfile(STATE, id, { displayName: id, isPublic: true });
    canonicalSocial(STATE).profiles.get(id).createdAt = new Date(Date.now() - 3 * 86400000).toISOString();
  }
  return STATE;
}

function register() {
  const ACTIONS = new Map();
  registerSocialActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
  const call = (name, userId, params) => ACTIONS.get(`social.${name}`)(
    { actor: { userId }, userId },
    { id: null, data: {}, meta: {} },
    params,
  );
  return call;
}

describe("social lens macro visibility", () => {
  it("refuses reply, react, repost, vote, poll results, and share on a private post", () => {
    world();
    const call = register();
    const created = call("createPost", "alice", {
      body: "secret poll",
      poll: { question: "Q", options: ["yes", "no"] },
    });
    assert.equal(created.ok, true);
    const id = created.result.post.id;
    canonicalSocial(globalThis._concordSTATE).posts.get(id).privacy = "private";

    for (const viewer of ["bob", "cy", null]) {
      assert.equal(call("addReply", viewer, { postId: id, body: "nope" }).ok, false);
      assert.equal(call("react", viewer, { postId: id, reaction: "like" }).ok, false);
      assert.equal(call("repost", viewer, { postId: id }).ok, false);
      assert.equal(call("votePoll", viewer, { postId: id, optionId: "opt_0" }).ok, false);
      assert.equal(call("pollResults", viewer, { postId: id }).ok, false);
      assert.equal(call("shareTargets", viewer, { postId: id }).ok, false);
    }
    assert.equal(call("addReply", "alice", { postId: id, body: "own note" }).ok, true);
    assert.equal(call("react", "alice", { postId: id, reaction: "like" }).ok, true);
    assert.equal(call("shareTargets", "alice", { postId: id }).ok, true);
    assert.equal(call("pollResults", "alice", { postId: id }).ok, true);
  });

  it("lets a follower reply to a followers-only post and hides it from a stranger", () => {
    const STATE = world();
    const call = register();
    followUser(STATE, "bob", "alice");
    const created = call("createPost", "alice", { body: "circle" });
    canonicalSocial(STATE).posts.get(created.result.post.id).privacy = "followers";
    const id = created.result.post.id;
    assert.equal(call("addReply", "bob", { postId: id, body: "hi" }).ok, true);
    assert.equal(call("react", "bob", { postId: id, reaction: "love" }).ok, true);
    assert.equal(call("addReply", "cy", { postId: id, body: "stranger" }).ok, false);
    assert.equal(call("react", "cy", { postId: id, reaction: "like" }).ok, false);
  });

  it("keeps a blocked viewer off writes both ways", () => {
    const STATE = world();
    const call = register();
    const created = call("createPost", "alice", { body: "public hello" });
    const id = created.result.post.id;
    setUserBlock(STATE, { userId: "alice", targetId: "cy", blocked: true });
    assert.equal(call("addReply", "cy", { postId: id, body: "blocked" }).ok, false);
    assert.equal(call("react", "cy", { postId: id, reaction: "like" }).ok, false);
    assert.equal(call("repost", "cy", { postId: id }).ok, false);
  });

  it("omits live Glimpses from the main feed and expired ones everywhere", () => {
    world();
    const call = register();
    const live = call("createPost", "alice", { body: "live glimpse" });
    const liveId = live.result.post.id;
    const storedLive = canonicalSocial(globalThis._concordSTATE).posts.get(liveId);
    storedLive.isStory = true;
    storedLive.expiresAt = new Date(Date.now() + 3600_000).toISOString();
    assert.equal(call("feed", "alice", {}).result.posts.some((p) => p.id === liveId), false);

    const gone = call("createPost", "alice", { body: "expired glimpse" });
    const goneId = gone.result.post.id;
    const storedGone = canonicalSocial(globalThis._concordSTATE).posts.get(goneId);
    storedGone.isStory = true;
    storedGone.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal(call("feed", "alice", {}).result.posts.some((p) => p.id === goneId), false);
    assert.equal(call("postDetail", "alice", { postId: goneId }).ok, false);
    assert.equal(call("addReply", "alice", { postId: goneId, body: "late" }).ok, false);
  });

  it("counts only public posts in trendingHashtags", () => {
    world();
    const call = register();
    call("createPost", "alice", { body: "public #chorus" });
    const priv = call("createPost", "alice", { body: "private #chorus #diary" });
    canonicalSocial(globalThis._concordSTATE).posts.get(priv.result.post.id).privacy = "private";
    const trending = call("trendingHashtags", "alice", {}).result.trending;
    const chorus = trending.find((row) => row.tag === "chorus");
    assert.ok(chorus);
    assert.equal(chorus.posts, 1);
    assert.equal(trending.some((row) => row.tag === "diary"), false);
  });
});
