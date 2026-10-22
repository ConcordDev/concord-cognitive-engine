import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { up } from "../migrations/482_social_canonical_store.js";
import { FEES } from "../economy/fees.js";
import {
  upsertProfile, createPost, followUser, addComment, sendMessage, canonicalSocial,
} from "../emergent/social-layer.js";
import { setSocialPreferences } from "../lib/social-loop.js";
import { followingFeed } from "../lib/social-feeds.js";
import { flushSocialStore, forgetSocialMemory } from "../lib/social-persist.js";
import { resetSocialRates } from "../lib/social-safety.js";
import { shareListing, shareStudioAsset } from "../lib/social-share.js";
import createSocialCoreRoutes from "../routes/social-core.js";
import createSocialGroupRoutes from "../routes/social-groups.js";
import { createModerationRouter } from "../routes/moderation.js";
import { submitReport, getModerationQueue } from "../lib/content-moderation.js";

function fresh() {
  const db = new Database(":memory:");
  up(db);
  const STATE = { db, dtus: new Map(), socialLens: { moderation: new Map() } };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  resetSocialRates();
  return STATE;
}

function ageProfile(STATE, userId, iso) {
  canonicalSocial(STATE).profiles.get(userId).createdAt = iso;
}

describe("social safety", { concurrency: 1 }, () => {
  beforeEach(() => { fresh(); });

  it("limits a new account, blocks duplicate and link-heavy posts, and lets an older account post more", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    const made = [];
    for (let i = 0; i < 5; i += 1) {
      made.push(createPost(STATE, { userId: "ana", content: `note ${i}`, privacy: "public" }));
    }
    assert.ok(made.every((row) => row.ok));
    const sixth = createPost(STATE, { userId: "ana", content: "note 6", privacy: "public" });
    assert.equal(sixth.status, 429);

    resetSocialRates();
    const first = createPost(STATE, { userId: "ana", content: "same words", privacy: "public" });
    assert.equal(first.ok, true);
    const again = createPost(STATE, { userId: "ana", content: "same words", privacy: "public" });
    assert.equal(again.status, 409);

    resetSocialRates();
    const links = createPost(STATE, {
      userId: "ana",
      content: "see https://a.example https://b.example https://c.example",
      privacy: "public",
    });
    assert.equal(links.status, 403);

    ageProfile(STATE, "ana", "2020-01-01T00:00:00.000Z");
    resetSocialRates();
    const older = [];
    for (let i = 0; i < 6; i += 1) older.push(createPost(STATE, { userId: "ana", content: `older ${i}`, privacy: "public" }));
    assert.ok(older.every((row) => row.ok));
    const olderLinks = createPost(STATE, {
      userId: "ana",
      content: "old https://a.example https://b.example https://c.example",
      privacy: "public",
    });
    assert.equal(olderLinks.ok, true);
  });

  it("hides keyword-muted text from another viewer and omits sensitive media until they opt in", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    ageProfile(STATE, "ana", "2020-01-01T00:00:00.000Z");
    ageProfile(STATE, "bea", "2020-01-01T00:00:00.000Z");
    followUser(STATE, "ana", "bea");
    setSocialPreferences(STATE, "ana", { keywordMutes: ["Quartz"] });
    const hidden = createPost(STATE, { userId: "bea", content: "buy quartz now", privacy: "public" });
    const loud = createPost(STATE, {
      userId: "bea",
      content: "plain hello",
      mediaUrl: "https://cdn.example/pic.jpg",
      mediaType: "image",
      sensitive: true,
      privacy: "public",
    });
    const feed = followingFeed(STATE, "ana");
    assert.equal(feed.posts.some((post) => post.id === hidden.post.id), false);
    const sensitive = feed.posts.find((post) => post.id === loud.post.id);
    assert.equal(sensitive.mediaUrl, null);
    assert.equal(sensitive.sensitiveHidden, true);
    setSocialPreferences(STATE, "ana", { showSensitive: true });
    const opened = followingFeed(STATE, "ana").posts.find((post) => post.id === loud.post.id);
    assert.equal(opened.mediaUrl, "https://cdn.example/pic.jpg");
    assert.equal(flushSocialStore(STATE), true);
    forgetSocialMemory(STATE);
    assert.equal(canonicalSocial(STATE).posts.get(loud.post.id).sensitive, true);
    assert.equal(canonicalSocial(STATE).profiles.get("ana").keywordMutes[0], "quartz");
  });

  it("rate-limits comments and direct messages for a new account", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    const post = createPost(STATE, { userId: "bea", content: "thread", privacy: "public" });
    let last;
    for (let i = 0; i < 11; i += 1) last = addComment(STATE, { userId: "ana", postId: post.post.id, content: `c${i}` });
    assert.equal(last.status, 429);
    resetSocialRates();
    let dm;
    for (let i = 0; i < 6; i += 1) dm = sendMessage(STATE, { fromUserId: "ana", toUserId: "bea", content: `m${i}` });
    assert.equal(dm.status, 429);
  });

  it("keeps a private group feed off the public list and away from non-members", async () => {
    const db = new Database(":memory:");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.header("x-user");
      if (id) req.user = { id };
      next();
    });
    app.use("/api/social", createSocialGroupRoutes({
      db,
      requireAuth: () => (req, _res, next) => { req.user = { id: req.header("x-user") || "anon" }; next(); },
    }));
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const created = await fetch(`http://127.0.0.1:${port}/api/social/group`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "ana" },
        body: JSON.stringify({ name: "Inner", visibility: "private" }),
      });
      const made = await created.json();
      assert.equal(created.status, 200);
      const listed = await fetch(`http://127.0.0.1:${port}/api/social/groups`, { headers: { "x-user": "bea" } });
      const listBody = await listed.json();
      assert.equal(listBody.groups.some((group) => group.groupId === made.groupId), false);
      const feed = await fetch(`http://127.0.0.1:${port}/api/social/group/${made.groupId}/feed`, { headers: { "x-user": "bea" } });
      assert.equal(feed.status, 404);
      const joined = await fetch(`http://127.0.0.1:${port}/api/social/group/${made.groupId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "bea" },
        body: "{}",
      });
      assert.equal(joined.status, 200);
      const memberFeed = await fetch(`http://127.0.0.1:${port}/api/social/group/${made.groupId}/feed`, { headers: { "x-user": "bea" } });
      assert.equal(memberFeed.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("shares a listing only for its owner and returns the fee schedule from economy/fees.js", async () => {
    const STATE = fresh();
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    ageProfile(STATE, "ana", "2020-01-01T00:00:00.000Z");
    STATE.db.exec(`CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, price REAL, currency TEXT
    )`);
    STATE.db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title, price, currency) VALUES (?, ?, ?, ?, ?)").run(
      "list-1", "ana", "Tape", 12, "USD",
    );
    const refused = shareListing(STATE, { userId: "bea", listingId: "list-1" });
    assert.equal(refused.status, 403);
    const shared = shareListing(STATE, { userId: "ana", listingId: "list-1" });
    assert.equal(shared.ok, true);
    assert.equal(shared.listing.price, 12);
    assert.equal(shared.listing.transferRate, FEES.TRANSFER);
    assert.equal(shared.listing.marketplaceRate, FEES.MARKETPLACE_PURCHASE);
    assert.equal(shared.listing.transferRate, 0.0146);
    assert.equal(shared.listing.marketplaceRate, 0.04);

    STATE.db.exec(`CREATE TABLE route_studio_projects (
      project_id TEXT PRIMARY KEY, name TEXT, created_by TEXT
    )`);
    STATE.db.exec(`CREATE TABLE route_studio_assets (
      asset_id TEXT PRIMARY KEY, project_id TEXT, name TEXT, mime_type TEXT, artifact_id TEXT, added_by TEXT
    )`);
    STATE.db.prepare("INSERT INTO route_studio_projects (project_id, name, created_by) VALUES (?, ?, ?)").run("proj", "Demo", "ana");
    STATE.db.prepare("INSERT INTO route_studio_assets (asset_id, project_id, name, mime_type, artifact_id, added_by) VALUES (?, ?, ?, ?, ?, ?)").run(
      "asset", "proj", "Take", "audio/wav", "https://cdn.example/take.wav", "ana",
    );
    const studio = shareStudioAsset(STATE, { userId: "ana", projectId: "proj", assetId: "asset" });
    assert.equal(studio.ok, true);
    assert.equal(studio.studio.audioUrl, "https://cdn.example/take.wav");
    assert.equal(studio.post.mediaType, "audio");
    const stranger = shareStudioAsset(STATE, { userId: "bea", projectId: "proj", assetId: "asset" });
    assert.equal(stranger.status, 403);

    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialCoreRoutes({
      db: STATE.db,
      requireAuth: () => (req, _res, next) => { req.user = { id: req.header("x-user") }; next(); },
    }));
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/social/listings/list-1/share`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "bea" },
        body: "{}",
      });
      const body = await res.json();
      assert.equal(res.status, 403);
      assert.equal(body.error, "You do not own this listing");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("resolves a queued report through the moderation route", async () => {
    const STATE = { moderation: undefined };
    const filed = submitReport(STATE, {
      reporterId: "ana",
      contentId: "post-1",
      contentType: "comment",
      category: "spam",
      reason: "this is spam",
    });
    assert.equal(filed.ok, true);
    const queued = getModerationQueue(STATE);
    assert.equal(queued.queue.length, 1);
    const app = express();
    app.use(express.json());
    app.use("/api/moderation", createModerationRouter({
      STATE,
      requireAuth: () => (req, _res, next) => { req.user = { id: "mod" }; next(); },
      requireRole: () => (req, _res, next) => { req.user = { id: "mod" }; next(); },
      asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    }));
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/moderation/resolve/${filed.report.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
