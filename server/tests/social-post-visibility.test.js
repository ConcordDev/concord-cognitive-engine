// A post the viewer cannot see stays out of feeds, hashtags, trending,
// search, permalinks, and comment listings.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addComment,
  canViewPost,
  canonicalSocial,
  createPost,
  followUser,
  getComments,
  getExploreFeed,
  getForYouFeed,
  getFollowingFeed,
  getPost,
  getTrendingContent,
  getTrendingTopics,
  upsertProfile,
} from "../emergent/social-layer.js";
import { followingFeed, forYouFeed, hashtagPosts, searchSocial } from "../lib/social-feeds.js";
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

function block(STATE, a, b) {
  STATE.socialLens.moderation.set(a, { muted: new Set(), blocked: new Set([b]) });
}

function texts(list) {
  return (list || []).map((post) => post.content || post.body || "");
}

describe("social post visibility", () => {
  it("shows a followers-only post to the author and followers, and hides it everywhere else", () => {
    const STATE = world();
    const made = createPost(STATE, { userId: "alice", content: "circle only", privacy: "followers", tags: ["circle"] });
    assert.equal(made.ok, true);
    const id = made.post.id;
    const post = canonicalSocial(STATE).posts.get(id);

    assert.equal(canViewPost("alice", post, STATE), true);
    assert.equal(canViewPost("bob", post, STATE), false);
    assert.equal(canViewPost(null, post, STATE), false);
    assert.equal(getPost(STATE, id, "cy").ok, false);
    assert.equal(getComments(STATE, id, { viewerId: "cy" }).ok, false);
    assert.equal(texts(getForYouFeed(STATE, "cy").posts).includes("circle only"), false);
    assert.equal(texts(getTrendingContent(STATE, { hours: 48 }).content).includes("circle only"), false);
    assert.equal(hashtagPosts(STATE, "cy", "circle").posts.length, 0);
    assert.equal(searchSocial(STATE, "cy", "circle").posts.length, 0);

    followUser(STATE, "bob", "alice");
    assert.equal(getPost(STATE, id, "bob").ok, true);
    assert.equal(getPost(STATE, id, "alice").ok, true);
    assert.equal(getComments(STATE, id, { viewerId: "bob" }).ok, true);
    assert.ok(texts(getFollowingFeed(STATE, "bob").posts).includes("circle only"));
    assert.ok(texts(followingFeed(STATE, "bob").posts).includes("circle only"));
    assert.ok(texts(forYouFeed(STATE, "bob").posts).includes("circle only"));
    assert.equal(hashtagPosts(STATE, "bob", "circle").posts.length, 1);
    assert.equal(searchSocial(STATE, "bob", "circle").posts.length, 1);
    assert.ok(texts(getTrendingContent(STATE, { hours: 48, viewerId: "bob" }).content).includes("circle only"));
    assert.equal(texts(getExploreFeed(STATE, {}).posts).includes("circle only"), false);
  });

  it("shows a private post only to the author", () => {
    const STATE = world();
    followUser(STATE, "bob", "alice");
    const made = createPost(STATE, { userId: "alice", content: "diary", privacy: "private", tags: ["diary"] });
    const id = made.post.id;
    assert.equal(getPost(STATE, id, "alice").post.content, "diary");
    assert.equal(getPost(STATE, id, "bob").ok, false);
    assert.equal(getPost(STATE, id, null).ok, false);
    assert.equal(getComments(STATE, id, { viewerId: "bob" }).ok, false);
    for (const viewer of ["bob", "cy", "alice"]) {
      assert.equal(texts(getExploreFeed(STATE, { viewerId: viewer }).posts).includes("diary"), false);
    }
    assert.equal(texts(getFollowingFeed(STATE, "bob").posts).includes("diary"), false);
    assert.equal(texts(forYouFeed(STATE, "bob").posts).includes("diary"), false);
    assert.equal(hashtagPosts(STATE, "alice", "diary").posts.length, 1);
    assert.equal(hashtagPosts(STATE, "bob", "diary").posts.length, 0);
    assert.ok(texts(getTrendingContent(STATE, { hours: 48, viewerId: "alice" }).content).includes("diary"));
    assert.equal(texts(getTrendingContent(STATE, { hours: 48, viewerId: "bob" }).content).includes("diary"), false);
  });

  it("never returns an expired story", () => {
    const STATE = world();
    followUser(STATE, "bob", "alice");
    const made = createPost(STATE, {
      userId: "alice",
      content: "gone story",
      privacy: "public",
      isStory: true,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      tags: ["story"],
    });
    assert.equal(made.ok, true);
    assert.equal(made.post.isStory, undefined);
    const stored = canonicalSocial(STATE).posts.get(made.post.id);
    assert.equal(stored.isStory, true);
    assert.equal(canViewPost("alice", stored, STATE), false);
    assert.equal(canViewPost("bob", stored, STATE), false);
    assert.equal(getPost(STATE, made.post.id, "alice").ok, false);
    assert.equal(getComments(STATE, made.post.id, { viewerId: "alice" }).ok, false);
    assert.equal(texts(getForYouFeed(STATE, "alice").posts).includes("gone story"), false);
    assert.equal(texts(getFollowingFeed(STATE, "bob").posts).includes("gone story"), false);
    assert.equal(hashtagPosts(STATE, "bob", "story").posts.length, 0);
    assert.equal(searchSocial(STATE, "bob", "story").posts.length, 0);
    assert.equal(texts(getTrendingContent(STATE, { hours: 48, viewerId: "bob" }).content).includes("gone story"), false);
    const topics = getTrendingTopics(STATE, { viewerId: "bob" }).topics.map((row) => row.topic);
    assert.equal(topics.includes("story"), false);
  });

  it("drops posts when either person has blocked the other", () => {
    const STATE = world();
    followUser(STATE, "bob", "alice");
    const made = createPost(STATE, { userId: "alice", content: "public hello", privacy: "public", tags: ["hello"] });
    addComment(STATE, { userId: "cy", postId: made.post.id, content: "from cy" });
    const id = made.post.id;

    block(STATE, "alice", "bob");
    assert.equal(getPost(STATE, id, "alice").ok, true);
    assert.equal(getPost(STATE, id, "bob").ok, false);
    assert.equal(getComments(STATE, id, { viewerId: "bob" }).ok, false);
    assert.equal(texts(followingFeed(STATE, "bob").posts).includes("public hello"), false);
    assert.equal(texts(forYouFeed(STATE, "bob").posts).includes("public hello"), false);
    assert.equal(hashtagPosts(STATE, "bob", "hello").posts.length, 0);
    assert.equal(searchSocial(STATE, "bob", "hello").posts.length, 0);
    assert.equal(texts(getTrendingContent(STATE, { hours: 48, viewerId: "bob" }).content).includes("public hello"), false);

    STATE.socialLens.moderation = new Map();
    block(STATE, "bob", "alice");
    assert.equal(getPost(STATE, id, "bob").ok, false);
    assert.equal(getPost(STATE, id, "cy").ok, true);
    const openThread = getComments(STATE, id, { viewerId: "alice" });
    assert.equal(openThread.ok, true);
    assert.equal(openThread.comments.some((row) => row.userId === "cy"), true);

    block(STATE, "alice", "cy");
    const hiddenReply = getComments(STATE, id, { viewerId: "alice" });
    assert.equal(hiddenReply.ok, true);
    assert.equal(hiddenReply.comments.some((row) => row.userId === "cy"), false);
    const cyView = getComments(STATE, id, { viewerId: "cy" });
    assert.equal(cyView.ok, false);
  });

  it("still returns a public post to a stranger and to a logged-out reader", () => {
    const STATE = world();
    const made = createPost(STATE, { userId: "alice", content: "open note", privacy: "public", tags: ["open"] });
    assert.equal(getPost(STATE, made.post.id, null).post.content, "open note");
    assert.equal(getPost(STATE, made.post.id, "cy").post.content, "open note");
    assert.ok(texts(getExploreFeed(STATE, {}).posts).includes("open note"));
    assert.ok(texts(getForYouFeed(STATE, "cy").posts).includes("open note"));
    assert.equal(hashtagPosts(STATE, "cy", "open").posts.length, 1);
    assert.equal(searchSocial(STATE, "cy", "open").posts.length, 1);
    assert.ok(texts(getTrendingContent(STATE, { hours: 48 }).content).includes("open note"));
  });

  it("hides a private post from the lens feed, hashtag page, permalink, and reply tree", () => {
    const ACTIONS = new Map();
    registerSocialActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
    const STATE = world();
    const call = (name, userId, params) => ACTIONS.get(`social.${name}`)(
      { actor: { userId }, userId },
      { id: null, data: {}, meta: {} },
      params,
    );
    const created = call("createPost", "alice", { body: "lens secret #quiet" });
    assert.equal(created.ok, true);
    const stored = canonicalSocial(STATE).posts.get(created.result.post.id);
    stored.privacy = "private";
    assert.equal(call("feed", "bob", {}).result.posts.some((post) => post.id === stored.id), false);
    assert.equal(call("hashtagFeed", "bob", { tag: "quiet" }).result.posts.length, 0);
    assert.equal(call("postDetail", "bob", { postId: stored.id }).ok, false);
    assert.equal(call("replyTree", "bob", { postId: stored.id }).ok, false);
    assert.equal(call("postDetail", "alice", { postId: stored.id }).ok, true);
    assert.equal(call("feed", "alice", {}).result.posts.some((post) => post.id === stored.id), true);
  });
});
