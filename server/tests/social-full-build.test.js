// Social full build (F-B row 5) — the legs the premise priced:
//   F1 residue — the engagement rate divides by total reach; zero reach
//     reports no rate and the basis (engagement over views) rides along.
//   F9 — Liked returns exactly the posts the user reacted to; the DTUs
//     read returns the user's authored DTUs (self: all; other viewer:
//     public only), agreeing with the profile counter's authorship test.
//   F10 — GET /api/social/export returns the caller's own records in
//     labelled sections (profile · posts · bookmarks · drafts).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialCoreRoutes from "../routes/social-core.js";
import {
  upsertProfile,
  createPost,
  addReaction,
  bookmarkPost,
  canonicalSocial,
  getCreatorAnalytics,
  getCreatorAnalyticsView,
  getLikedPosts,
  getUserDtus,
} from "../emergent/social-layer.js";
import { saveDraft } from "../lib/social-loop.js";

describe("social full build — analytics basis, liked/dtus reads, own-records export", () => {
  let db;
  let server;
  let base;
  let STATE;
  let postA;
  let postB;

  before(async () => {
    db = new Database(":memory:");
    STATE = { db, dtus: new Map(), socialLens: {} };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/social", createSocialCoreRoutes({
      db,
      requireAuth: () => (req, res, next) => (req.user ? next() : res.status(401).json({ ok: false, error: "auth required" })),
    }));
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    upsertProfile(STATE, "alice", { displayName: "Alice", isPublic: true });
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    postA = createPost(STATE, { userId: "alice", content: "alice first post about lenses" }).post;
    postB = createPost(STATE, { userId: "bob", content: "bob post about gardens" }).post;
    // Bob reacts to Alice's post; Alice reacts to nothing.
    addReaction(STATE, { userId: "bob", postId: postA.id, type: "heart" });
    // Alice bookmarks Bob's post; Alice saves a draft.
    bookmarkPost(STATE, { userId: "alice", postId: postB.id });
    saveDraft(STATE, { userId: "alice", content: "alice unfinished thought" });
    // DTUs: one public + one private by Alice, one by Bob.
    STATE.dtus.set("dtu_pub", { id: "dtu_pub", author: "alice", title: "Alice public DTU", createdAt: "2026-11-01T00:00:00.000Z" });
    STATE.dtus.set("dtu_priv", { id: "dtu_priv", author: "alice", title: "Alice private DTU", createdAt: "2026-11-02T00:00:00.000Z" });
    STATE.dtus.set("dtu_bob", { id: "dtu_bob", meta: { authorId: "bob" }, title: "Bob DTU", createdAt: "2026-11-03T00:00:00.000Z" });
    canonicalSocial(STATE).publicDtus.add("dtu_pub");
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("zero reach reports rate 0 with the basis attached (no manufactured percentage)", () => {
    const raw = getCreatorAnalytics(STATE, "alice", "alice");
    assert.equal(raw.totalReach, 0);
    assert.equal(raw.engagementRate, 0);
    assert.equal(raw.engagementBasis.totalReach, 0);
    assert.ok(raw.engagementBasis.totalEngagement > 0, "the reaction still counts as engagement");
    const view = getCreatorAnalyticsView(STATE, "alice");
    assert.equal(view.overview.engagementRate, 0);
    assert.deepEqual(view.overview.engagementBasis, raw.engagementBasis);
  });

  it("with reach, the rate is engagement over views", () => {
    const post = canonicalSocial(STATE).posts.get(postA.id);
    post.viewCount = 10;
    const raw = getCreatorAnalytics(STATE, "alice", "alice");
    assert.equal(raw.totalReach, 10);
    assert.ok(raw.engagementRate > 0);
    assert.equal(raw.engagementRate, Math.round((raw.engagementBasis.totalEngagement / 10) * 10000) / 100);
    post.viewCount = 0;
  });

  it("liked read returns exactly the posts the user reacted to", async () => {
    const res = await fetch(`${base}/api/social/posts/liked/bob`, { headers: { "x-user-id": "bob" } });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.total, 1);
    assert.equal(body.posts[0].id, postA.id);
    const alice = getLikedPosts(STATE, "alice", {});
    assert.equal(alice.total, 0);
  });

  it("dtus read: self sees all authored, another viewer sees public only", async () => {
    const self = await (await fetch(`${base}/api/social/dtus/user/alice`, { headers: { "x-user-id": "alice" } })).json();
    assert.equal(self.total, 2);
    assert.deepEqual(self.dtus.map((d) => d.id).sort(), ["dtu_priv", "dtu_pub"]);
    const other = await (await fetch(`${base}/api/social/dtus/user/alice`, { headers: { "x-user-id": "bob" } })).json();
    assert.equal(other.total, 1);
    assert.equal(other.dtus[0].id, "dtu_pub");
    assert.equal(other.dtus[0].title, "Alice public DTU");
  });

  it("export returns the caller's own records in labelled sections", async () => {
    const res = await fetch(`${base}/api/social/export`, { headers: { "x-user-id": "alice" } });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.kind, "social-my-records");
    assert.ok(body.profile, "profile section present");
    assert.equal(body.counts.posts, 1);
    assert.equal(body.posts[0].id, postA.id);
    assert.equal(body.counts.bookmarks, 1);
    assert.equal(body.bookmarks[0].id, postB.id);
    assert.equal(body.counts.drafts, 1);
    assert.equal(body.drafts[0].content, "alice unfinished thought");
  });

  it("export is the caller's own — bob's export holds none of alice's records", async () => {
    const body = await (await fetch(`${base}/api/social/export`, { headers: { "x-user-id": "bob" } })).json();
    assert.equal(body.counts.posts, 1);
    assert.equal(body.posts[0].id, postB.id);
    assert.equal(body.counts.bookmarks, 0);
    assert.equal(body.counts.drafts, 0);
  });
});
