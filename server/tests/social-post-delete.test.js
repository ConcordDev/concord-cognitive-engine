/**
 * DELETE /api/social/post/:id is owner-only and drops the post from feeds,
 * trending, explore, and search. A private row in social_post_records stays
 * invisible to a second user after the memory cache is rebuilt from SQLite.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import { upsertProfile, canonicalSocial, followUser } from "../emergent/social-layer.js";
import { flushSocialStore } from "../lib/social-persist.js";
import { resetSocialRates } from "../lib/social-safety.js";
import { up as socialStoreUp } from "../migrations/482_social_canonical_store.js";

function requireAuth() {
  return (req, res, next) => {
    const id = req.headers["x-user-id"];
    if (!id) return res.status(401).json({ ok: false, error: "auth required" });
    req.user = { id: String(id) };
    next();
  };
}

function texts(rows) {
  return (rows || []).map((row) => row.content || row.body || row.title || "");
}

describe("social post delete and private-record visibility", { concurrency: 1 }, () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      author_id TEXT,
      content TEXT,
      created_at INTEGER
    )`);
    socialStoreUp(db);
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
    globalThis._concordLLM = null;
    globalThis._concordBrains = { status: "offline" };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/social", createSocialEngagementRoutes({ db, requireAuth }));

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    upsertProfile(STATE, "alice", { displayName: "Alice", isPublic: true });
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    for (const id of ["alice", "bob"]) {
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

  async function del(path, user) {
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: user ? { "x-user-id": user } : {},
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("lets the owner delete and hides the post from the other user's feeds", async () => {
    const made = await post("/api/social/post", "alice", {
      content: "delete me please",
      privacy: "public",
      tags: ["scratch"],
    });
    assert.equal(made.status, 200);
    const id = made.json.post.id;
    flushSocialStore(globalThis._concordSTATE);
    assert.equal(db.prepare("SELECT id FROM social_post_records WHERE id = ?").get(id)?.id, id);

    const anon = await del(`/api/social/post/${id}`, null);
    assert.equal(anon.status, 401);

    const stranger = await del(`/api/social/post/${id}`, "bob");
    assert.equal(stranger.status, 403);
    assert.equal(canonicalSocial(globalThis._concordSTATE).posts.has(id), true);

    const missing = await del("/api/social/post/post_missing", "alice");
    assert.equal(missing.status, 404);

    const gone = await del(`/api/social/post/${id}`, "alice");
    assert.equal(gone.status, 200);
    assert.equal(gone.json.ok, true);
    assert.equal(canonicalSocial(globalThis._concordSTATE).posts.has(id), false);
    assert.equal(db.prepare("SELECT id FROM social_posts WHERE id = ?").get(id), undefined);
    assert.equal(db.prepare("SELECT id FROM social_post_records WHERE id = ?").get(id), undefined);

    for (const viewer of ["alice", "bob"]) {
      assert.equal(texts((await get("/api/social/feed/for-you", viewer)).json.posts).includes("delete me please"), false);
      assert.equal(texts((await get("/api/social/feed/following", viewer)).json.posts).includes("delete me please"), false);
      assert.equal(texts((await get("/api/social/trending", viewer)).json.posts).includes("delete me please"), false);
      assert.equal(texts((await get("/api/social/feed/explore", viewer)).json.posts).includes("delete me please"), false);
      assert.equal(texts((await get("/api/social/search?q=scratch", viewer)).json.posts).includes("delete me please"), false);
    }
  });

  it("keeps a private social_post_records row off the second user's surfaces after reload", async () => {
    const STATE = globalThis._concordSTATE;
    const made = await post("/api/social/post", "alice", {
      content: "column only secret",
      privacy: "private",
      tags: ["hush"],
    });
    assert.equal(made.json.post.privacy, "private");
    const id = made.json.post.id;
    flushSocialStore(globalThis._concordSTATE);
    db.prepare("UPDATE social_post_records SET privacy = 'private' WHERE id = ?").run(id);
    const row = db.prepare("SELECT payload_json, privacy FROM social_post_records WHERE id = ?").get(id);
    const payload = JSON.parse(row.payload_json);
    delete payload.privacy;
    db.prepare("UPDATE social_post_records SET payload_json = ?, privacy = 'private' WHERE id = ?").run(JSON.stringify(payload), id);

    delete STATE._social;
    STATE.__socialDbHydrated = false;
    STATE.__socialHydrating = false;

    const bobForYou = await get("/api/social/feed/for-you", "bob");
    assert.equal(texts(bobForYou.json.posts).includes("column only secret"), false);
    const bobFollowing = await get("/api/social/feed/following", "bob");
    assert.equal(texts(bobFollowing.json.posts).includes("column only secret"), false);
    const bobTrending = await get("/api/social/trending", "bob");
    assert.equal(texts(bobTrending.json.posts).includes("column only secret"), false);
    assert.equal((bobTrending.json.hashtags || []).some((row) => (row.tag || row.topic) === "hush"), false);
    const bobExplore = await get("/api/social/feed/explore", "bob");
    assert.equal(texts(bobExplore.json.posts).includes("column only secret"), false);
    const bobSearch = await get("/api/social/search?q=hush", "bob");
    assert.equal(texts(bobSearch.json.posts).includes("column only secret"), false);

    const aliceForYou = await get("/api/social/feed/for-you", "alice");
    assert.ok(texts(aliceForYou.json.posts).includes("column only secret"));
  });
});
