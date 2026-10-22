import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/482_social_canonical_store.js";
import { upsertProfile, createPost, followUser, canonicalSocial } from "../emergent/social-layer.js";
import { flushSocialStore, forgetSocialMemory } from "../lib/social-persist.js";
import {
  followingFeed, forYouFeed, feedbackPost, createList, addListMember, listFeed,
  createPack, joinPack, followHashtag, hashtagPosts, searchSocial, setFeedPreference, getLists,
} from "../lib/social-feeds.js";

function fresh() {
  const db = new Database(":memory:");
  up(db);
  const STATE = { db, dtus: new Map(), socialLens: { moderation: new Map() } };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

describe("social feeds and search", { concurrency: 1 }, () => {
  beforeEach(() => { fresh(); });

  it("serves following in reverse chronological order and ranks For You with a reason", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    followUser(STATE, "ana", "bea");
    const older = createPost(STATE, { userId: "bea", content: "older", privacy: "public" });
    const newer = createPost(STATE, { userId: "bea", content: "newer", privacy: "public" });
    canonicalSocial(STATE).posts.get(older.post.id).createdAt = "2020-01-01T00:00:00.000Z";
    canonicalSocial(STATE).posts.get(newer.post.id).createdAt = "2024-01-01T00:00:00.000Z";
    const followed = followingFeed(STATE, "ana");
    assert.equal(followed.posts[0].id, newer.post.id);
    assert.equal(followed.posts[1].id, older.post.id);
    const ranked = forYouFeed(STATE, "ana");
    assert.ok(ranked.posts.length >= 1);
    assert.ok(ranked.posts.every((post) => Array.isArray(post.why) && post.why.includes("Recent")));
    const fromBea = ranked.posts.find((post) => post.userId === "bea");
    assert.ok(fromBea.why.includes("You follow the author"));
  });

  it("hides a post the viewer is not interested in and an author they want less of", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    const post = createPost(STATE, { userId: "bea", content: "skip me", privacy: "public" });
    assert.equal(feedbackPost(STATE, "ana", { postId: post.post.id, action: "not-interested" }).ok, true);
    assert.equal(forYouFeed(STATE, "ana").posts.some((row) => row.id === post.post.id), false);
    const other = createPost(STATE, { userId: "bea", content: "also bea", privacy: "public" });
    assert.equal(feedbackPost(STATE, "ana", { postId: other.post.id, action: "less" }).ok, true);
    assert.equal(forYouFeed(STATE, "ana").posts.some((row) => row.userId === "bea"), false);
  });

  it("keeps a private post and a blocked author out of search", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    upsertProfile(STATE, "cy", { displayName: "Cy", isPublic: true });
    createPost(STATE, { userId: "bea", content: "public quartz", privacy: "public", tags: ["quartz"] });
    createPost(STATE, { userId: "bea", content: "secret quartz", privacy: "private" });
    createPost(STATE, { userId: "cy", content: "blocked quartz", privacy: "public" });
    STATE.socialLens.moderation.set("ana", { muted: new Set(), blocked: new Set(["cy"]) });
    const found = searchSocial(STATE, "ana", "quartz");
    assert.equal(found.posts.length, 1);
    assert.equal(found.posts[0].content, "public quartz");
    assert.ok(found.hashtags.some((row) => row.tag === "quartz"));
    assert.ok(found.engine === "fts5" || found.engine === "scan");
    assert.ok(found.recent.includes("quartz"));
  });

  it("builds a list feed, a starter pack, and a followed hashtag", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    upsertProfile(STATE, "cy", { displayName: "Cy", isPublic: true });
    createPost(STATE, { userId: "bea", content: "from bea", privacy: "public", tags: ["live"] });
    createPost(STATE, { userId: "cy", content: "from cy", privacy: "public" });
    const list = createList(STATE, "ana", "Friends");
    addListMember(STATE, "ana", list.list.id, "bea");
    const feed = listFeed(STATE, "ana", list.list.id);
    assert.deepEqual(feed.posts.map((post) => post.content), ["from bea"]);
    const tooBig = createPack(STATE, "ana", { name: "big", people: Array.from({ length: 151 }, (_, i) => `u${i}`), feeds: [] });
    assert.equal(tooBig.ok, false);
    const tooManyFeeds = createPack(STATE, "ana", { name: "wide", people: ["bea"], feeds: ["a", "b", "c", "d"] });
    assert.equal(tooManyFeeds.ok, false);
    const pack = createPack(STATE, "ana", { name: "Night", people: ["bea"], feeds: ["live"] });
    const joined = joinPack(STATE, "cy", pack.pack.id, "ana");
    assert.equal(joined.followed, 1);
    assert.ok(canonicalSocial(STATE).notifications.get("ana").some((note) => note.type === "pack_join"));
    followHashtag(STATE, "cy", "#live");
    const topic = hashtagPosts(STATE, "cy", "live");
    assert.equal(topic.following, true);
    assert.equal(topic.posts[0].content, "from bea");
  });

  it("remembers the feed preference and a list across a restart", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    setFeedPreference(STATE, "ana", "forYou");
    const list = createList(STATE, "ana", "Keep");
    assert.equal(flushSocialStore(STATE), true);
    forgetSocialMemory(STATE);
    const again = getLists(STATE, "ana");
    assert.equal(again.feedDefault, "forYou");
    assert.equal(again.lists[0].id, list.list.id);
  });
});
