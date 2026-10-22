// Explore and /api/social/trending are mounted ahead of the inline server.js
// handlers. A response of { handler: "legacy" } means the override lost.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import {
  createPost,
  addReaction,
  upsertProfile,
  canonicalSocial,
  computeTrending,
} from "../emergent/social-layer.js";
import { setUserBlock } from "../lib/social-loop.js";

function legacy(_req, res) {
  res.json({ ok: true, handler: "legacy" });
}

describe("social explore and trending overrides", () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = new Database(":memory:");
    const STATE = { db, dtus: new Map(), socialLens: {} };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};

    const app = express();
    app.use(express.json());
    // Production auth runs before /api/social. Explore is public, so the
    // viewer is whoever that middleware already attached.
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/social", createSocialEngagementRoutes({
      db,
      requireAuth: () => (_req, _res, next) => next(),
    }));
    app.get("/api/social/feed/explore", legacy);
    app.get("/api/social/trending", legacy);

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

    const popular = createPost(STATE, {
      userId: "alice",
      content: "public popular chorus",
      privacy: "public",
      tags: ["chorus"],
    });
    assert.equal(popular.ok, true);
    const loved = addReaction(STATE, { userId: "bob", postId: popular.post.id, type: "like" });
    assert.equal(loved.ok, true);

    assert.equal(createPost(STATE, {
      userId: "alice",
      content: "followers only secret",
      privacy: "followers",
      tags: ["secret"],
    }).ok, true);
    assert.equal(createPost(STATE, {
      userId: "alice",
      content: "private diary",
      privacy: "private",
      tags: ["diary"],
    }).ok, true);
    assert.equal(createPost(STATE, {
      userId: "alice",
      content: "expired story",
      privacy: "public",
      isStory: true,
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
      tags: ["gone"],
    }).ok, true);
    const blocked = createPost(STATE, {
      userId: "bob",
      content: "blocked author note",
      privacy: "public",
      tags: ["blocked"],
    });
    assert.equal(blocked.ok, true);
    assert.equal(setUserBlock(STATE, { userId: "cara", targetId: "bob", blocked: true }).ok, true);

    STATE.dtus.set("dtu_wide", {
      id: "dtu_wide",
      title: "Wider catalog note",
      author: "alice",
      createdAt: new Date().toISOString(),
      tags: ["catalog"],
    });
    canonicalSocial(STATE).publicDtus.add("dtu_wide");
    const catalog = computeTrending(STATE, 20);
    assert.ok(catalog.trending.some((row) => row.title === "Wider catalog note"));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function get(path, user) {
    const res = await fetch(`${base}${path}`, {
      headers: user ? { "x-user-id": user } : {},
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  function texts(rows) {
    return (rows || []).map((row) => row.content || row.title);
  }

  it("shows a stranger only the public popular post on Explore", async () => {
    const res = await get("/api/social/feed/explore", "cara");
    assert.equal(res.status, 200);
    assert.equal(res.json.source, "social-explore");
    assert.notEqual(res.json.handler, "legacy");
    const seen = texts(res.json.posts);
    assert.ok(seen.includes("public popular chorus"));
    assert.ok(!seen.includes("followers only secret"));
    assert.ok(!seen.includes("private diary"));
    assert.ok(!seen.includes("expired story"));
    assert.ok(!seen.includes("blocked author note"));
    assert.ok(!seen.includes("Wider catalog note"));
  });

  it("keeps followers-only posts off Explore even for the author", async () => {
    const res = await get("/api/social/feed/explore", "alice");
    const seen = texts(res.json.posts);
    assert.equal(res.json.source, "social-explore");
    assert.ok(seen.includes("public popular chorus"));
    assert.ok(seen.includes("blocked author note"));
    assert.ok(!seen.includes("followers only secret"));
    assert.ok(!seen.includes("private diary"));
    assert.ok(!seen.includes("expired story"));
  });

  it("ranks social posts and hashtags for a stranger, not catalog DTUs", async () => {
    const res = await get("/api/social/trending", "cara");
    assert.equal(res.status, 200);
    assert.equal(res.json.source, "social-trending");
    assert.notEqual(res.json.handler, "legacy");
    const seen = texts(res.json.posts);
    assert.deepEqual(seen, texts(res.json.trending));
    assert.ok(seen.includes("public popular chorus"));
    assert.ok(!seen.includes("followers only secret"));
    assert.ok(!seen.includes("private diary"));
    assert.ok(!seen.includes("expired story"));
    assert.ok(!seen.includes("blocked author note"));
    assert.ok(!seen.includes("Wider catalog note"));
    assert.ok(res.json.posts.every((row) => row.dtuId == null));
    const tags = res.json.hashtags.map((row) => row.tag);
    assert.ok(tags.includes("chorus"));
    assert.ok(!tags.includes("secret"));
    assert.ok(!tags.includes("diary"));
    assert.ok(!tags.includes("catalog"));
    const chorus = res.json.posts.find((row) => row.content === "public popular chorus");
    assert.ok(chorus.trendScore > 0);
  });

  it("hides the same posts from an anonymous viewer", async () => {
    const explore = await get("/api/social/feed/explore");
    const trending = await get("/api/social/trending");
    for (const res of [explore, trending]) {
      const seen = texts(res.json.posts);
      assert.ok(seen.includes("public popular chorus"));
      assert.ok(seen.includes("blocked author note"));
      assert.ok(!seen.includes("followers only secret"));
      assert.ok(!seen.includes("private diary"));
      assert.ok(!seen.includes("expired story"));
    }
  });
});
