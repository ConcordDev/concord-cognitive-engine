/**
 * POST /api/social/post override: creates public, followers-only, and
 * private posts with brains marked unavailable. Private posts stay off
 * stranger, explore, trending, and search surfaces.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import { upsertProfile, canonicalSocial, followUser } from "../emergent/social-layer.js";
import { resetSocialRates } from "../lib/social-safety.js";

function requireAuth() {
  return (req, res, next) => {
    const id = req.headers["x-user-id"];
    if (!id) return res.status(401).json({ ok: false, error: "auth required" });
    req.user = { id: String(id) };
    next();
  };
}

function texts(rows) {
  return (rows || []).map((row) => row.content || row.body || row.title);
}

describe("social post create override", { concurrency: 1 }, () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = new Database(":memory:");
    resetSocialRates();
    const STATE = {
      db,
      dtus: new Map(),
      socialLens: {},
      llm: null,
      brains: { status: "offline", available: false },
    };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};
    // Brains / AI marked unavailable — posting must still work.
    globalThis._concordLLM = null;
    globalThis._concordBrains = { status: "offline" };

    const app = express();
    app.use(express.json());
    // Production session middleware attaches req.user before /api/social.
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/social", createSocialEngagementRoutes({ db, requireAuth }));
    app.post("/api/social/post", (_req, res) => res.json({ ok: true, handler: "legacy" }));

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    upsertProfile(STATE, "alice", { displayName: "Alice", isPublic: true });
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    upsertProfile(STATE, "cara", { displayName: "Cara", isPublic: true });
    for (const id of ["alice", "bob", "cara"]) {
      canonicalSocial(STATE).profiles.get(id).createdAt = "2020-01-01T00:00:00.000Z";
    }
    followUser(STATE, "bob", "alice");
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    resetSocialRates();
  });

  async function post(path, user, body) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(user ? { "x-user-id": user } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  async function get(path, user) {
    const res = await fetch(`${base}${path}`, {
      headers: user ? { "x-user-id": user } : {},
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("refuses an anonymous write", async () => {
    const res = await post("/api/social/post", null, { content: "nope", privacy: "public" });
    assert.equal(res.status, 401);
    assert.equal(res.json.ok, false);
  });

  it("creates public, followers-only, and private posts while brains are offline", async () => {
    const publicPost = await post("/api/social/post", "alice", {
      content: "public chorus",
      privacy: "public",
      tags: ["chorus"],
    });
    assert.equal(publicPost.json.handler, undefined);
    assert.equal(publicPost.status, 200);
    assert.equal(publicPost.json.ok, true);
    assert.equal(publicPost.json.post.privacy, "public");
    assert.equal(publicPost.json.post.content, "public chorus");
    assert.ok(Array.isArray(publicPost.json.post.media));
    assert.ok(Array.isArray(publicPost.json.post.hashtags));
    assert.ok(Array.isArray(publicPost.json.post.comments));
    assert.ok(Array.isArray(publicPost.json.post.tags));
    assert.ok(Array.isArray(publicPost.json.post.mentionedUsers));

    const followers = await post("/api/social/post", "alice", {
      content: "followers only circle",
      privacy: "followers",
      tags: ["circle"],
    });
    assert.equal(followers.status, 200);
    assert.equal(followers.json.ok, true);
    assert.equal(followers.json.post.privacy, "followers");

    const priv = await post("/api/social/post", "alice", {
      content: "private diary",
      privacy: "private",
      tags: ["diary"],
    });
    assert.equal(priv.status, 200);
    assert.equal(priv.json.ok, true);
    assert.equal(priv.json.post.privacy, "private");

    const stored = canonicalSocial(globalThis._concordSTATE).posts;
    assert.equal(stored.get(publicPost.json.post.id).content, "public chorus");
    assert.equal(stored.get(followers.json.post.id).privacy, "followers");
    assert.equal(stored.get(priv.json.post.id).privacy, "private");
  });

  it("shows every audience in the author's own feed and profile", async () => {
    const feed = await get("/api/social/feed/following", "alice");
    assert.equal(feed.status, 200);
    const feedTexts = texts(feed.json.posts);
    assert.ok(feedTexts.includes("public chorus"));
    assert.ok(feedTexts.includes("followers only circle"));
    assert.ok(feedTexts.includes("private diary"));

    const profile = await get("/api/social/posts/user/alice", "alice");
    const profileTexts = texts(profile.json.posts);
    assert.ok(profileTexts.includes("public chorus"));
    assert.ok(profileTexts.includes("followers only circle"));
    assert.ok(profileTexts.includes("private diary"));
  });

  it("hides a private post from a stranger, explore, trending, and search", async () => {
    const strangerFeed = await get("/api/social/feed/following", "cara");
    const strangerTexts = texts(strangerFeed.json.posts);
    assert.equal(strangerTexts.includes("private diary"), false);
    assert.equal(strangerTexts.includes("followers only circle"), false);

    const strangerForYou = await get("/api/social/feed/for-you", "cara");
    assert.equal(texts(strangerForYou.json.posts).includes("private diary"), false);
    assert.equal(texts(strangerForYou.json.posts).includes("followers only circle"), false);

    const authorForYou = await get("/api/social/feed/for-you", "alice");
    assert.ok(texts(authorForYou.json.posts).includes("private diary"));
    assert.ok(texts(authorForYou.json.posts).includes("followers only circle"));

    const followerForYou = await get("/api/social/feed/for-you", "bob");
    assert.ok(texts(followerForYou.json.posts).includes("followers only circle"));
    assert.equal(texts(followerForYou.json.posts).includes("private diary"), false);

    const strangerProfile = await get("/api/social/posts/user/alice", "cara");
    const strangerProfileTexts = texts(strangerProfile.json.posts);
    assert.ok(strangerProfileTexts.includes("public chorus"));
    assert.equal(strangerProfileTexts.includes("private diary"), false);
    assert.equal(strangerProfileTexts.includes("followers only circle"), false);

    const followerProfile = await get("/api/social/posts/user/alice", "bob");
    const followerTexts = texts(followerProfile.json.posts);
    assert.ok(followerTexts.includes("public chorus"));
    assert.ok(followerTexts.includes("followers only circle"));
    assert.equal(followerTexts.includes("private diary"), false);

    const anonProfile = await get("/api/social/posts/user/alice", null);
    const anonTexts = texts(anonProfile.json.posts);
    assert.ok(anonTexts.includes("public chorus"));
    assert.equal(anonTexts.includes("private diary"), false);
    assert.equal(anonTexts.includes("followers only circle"), false);

    const explore = await get("/api/social/feed/explore", "cara");
    const exploreTexts = texts(explore.json.posts);
    assert.ok(exploreTexts.includes("public chorus"));
    assert.equal(exploreTexts.includes("private diary"), false);
    assert.equal(exploreTexts.includes("followers only circle"), false);

    const trending = await get("/api/social/trending", "cara");
    const trendPosts = texts(trending.json.posts);
    const trendTags = (trending.json.hashtags || []).map((row) => row.tag || row.topic || row);
    assert.equal(trendPosts.includes("private diary"), false);
    assert.equal(trendTags.includes("diary"), false);

    const search = await get("/api/social/search?q=diary", "cara");
    assert.equal(texts(search.json.posts).includes("private diary"), false);
    const searchAuthor = await get("/api/social/search?q=diary", "alice");
    assert.ok(texts(searchAuthor.json.posts).includes("private diary"));
  });

  it("returns the server error on ok:false instead of 200-ok wrapping", async () => {
    const empty = await post("/api/social/post", "alice", { content: "" });
    assert.notEqual(empty.status, 200);
    assert.equal(empty.json.ok, false);
    assert.ok(empty.json.error);
  });
});
