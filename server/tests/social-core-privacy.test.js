// Phase 1 social privacy: trending audience, notification ownership,
// blocks, listing tags, citations, erasure, and DM participant checks.
// The router is mounted ahead of stub "legacy" handlers so a 200 from the
// legacy shape would fail the override tests.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import createSocialExtendedRouter from "../routes/social-extended.js";
import registerSocialActions from "../domains/social.js";
import registerMessageActions from "../domains/message.js";
import {
  createPost,
  createNotification,
  addComment,
  followUser,
  sharePost,
  sendMessage,
  getMessages,
  getTrendingContent,
  getTrendingCreators,
  getTrendingDomains,
  upsertProfile,
  canonicalSocial,
  purgeUserSocialRecords,
  getNotifications,
} from "../emergent/social-layer.js";
import { executeAccountDeletion } from "../lib/account-lifecycle.js";
import { getModerationQueue } from "../lib/content-moderation.js";

function requireAuth() {
  return (req, res, next) => {
    const id = req.headers["x-user-id"];
    if (!id) return res.status(401).json({ ok: false, error: "auth required" });
    req.user = { id: String(id) };
    next();
  };
}

function legacy(_req, res) {
  res.json({ ok: true, handler: "legacy" });
}

const ACTIONS = new Map();
registerSocialActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
registerMessageActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  assert.ok(fn, name);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

describe("social core privacy", { concurrency: 1 }, () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT,
        role TEXT, created_at TEXT, is_active INTEGER DEFAULT 1
      );
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, description TEXT,
        price_cents INTEGER, currency TEXT, visibility TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE social_posts (
        id TEXT PRIMARY KEY, user_id TEXT, author_id TEXT, content TEXT, created_at INTEGER
      );
    `);
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES ('alice', 'alice', 'alice@ex.test', 'x', 'member', datetime('now'), 1)").run();
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES ('bob', 'bob', 'bob@ex.test', 'x', 'member', datetime('now'), 1)").run();
    db.prepare("INSERT INTO marketplace_listings (id, owner_user_id, title, description, price_cents, currency, visibility, created_at, updated_at) VALUES ('list_a', 'alice', 'Track', '', 100, 'USD', 'published', datetime('now'), datetime('now'))").run();

    const STATE = {
      db,
      dtus: new Map(),
      socialLens: {},
    };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};

    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialEngagementRoutes({ db, requireAuth }));
    app.use("/api/social-extended", createSocialExtendedRouter({ STATE, requireAuth }));
    for (const [method, path] of [
      ["get", "/api/social/notifications"],
      ["get", "/api/social/notifications/count"],
      ["post", "/api/social/notifications/read-all"],
      ["post", "/api/social/notifications/:id/read"],
      ["delete", "/api/social/notifications/:id"],
      ["get", "/api/social/following-activity"],
      ["get", "/api/social/analytics/creator"],
      ["post", "/api/social/follow"],
      ["post", "/api/social/comment"],
      ["post", "/api/social/share"],
      ["post", "/api/social/dm"],
      ["get", "/api/social/dm/:conversationId"],
      ["post", "/api/social/cite"],
      ["get", "/api/social/topics/trending"],
    ]) {
      app[method](path, legacy);
    }

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function hit(method, path, { user, body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(user ? { "x-user-id": user } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("hides followers-only and private posts from trending for a stranger and for anon", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "alice", { displayName: "Alice", isPublic: true });
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    // This suite posts more than a brand-new account is allowed to.
    // The accounts under test are established.
    canonicalSocial(STATE).profiles.get("alice").createdAt = "2020-01-01T00:00:00.000Z";
    canonicalSocial(STATE).profiles.get("bob").createdAt = "2020-01-01T00:00:00.000Z";
    const pub = createPost(STATE, { userId: "alice", content: "public hello", privacy: "public", tags: ["music"] });
    createPost(STATE, { userId: "alice", content: "followers only secret", privacy: "followers", tags: ["secret"] });
    createPost(STATE, { userId: "alice", content: "private diary", privacy: "private", tags: ["diary"] });
    assert.equal(pub.ok, true);

    const content = getTrendingContent(STATE, { hours: 48 });
    const texts = content.content.map((p) => p.content);
    assert.deepEqual(texts, ["public hello"]);

    const creators = getTrendingCreators(STATE, { days: 7 });
    assert.equal(creators.creators.length, 1);
    assert.equal(creators.creators[0].postCount, 1);

    const domains = getTrendingDomains(STATE);
    assert.deepEqual(domains.domains.map((d) => d.domain), ["music"]);
  });

  it("notification routes are the new handler and stay inside the caller's store", async () => {
    const STATE = globalThis._concordSTATE;
    const made = createPost(STATE, { userId: "alice", content: "comment me", privacy: "public" });
    const comment = addComment(STATE, { userId: "bob", postId: made.post.id, content: "nice" });
    assert.equal(comment.ok, true);
    const mine = getNotifications(STATE, "alice");
    const note = mine.notifications.find((n) => n.type === "comment");
    assert.ok(note, "author receives a comment notification from the social store");

    const list = await hit("GET", "/api/social/notifications", { user: "alice" });
    assert.equal(list.status, 200);
    assert.notEqual(list.json.handler, "legacy");
    assert.ok(list.json.notifications.some((n) => n.type === "comment" && n.message));

    const other = await hit("GET", "/api/social/notifications", { user: "bob" });
    assert.ok(!other.json.notifications.some((n) => n.id === note.id));

    const anon = await hit("POST", `/api/social/notifications/${note.id}/read`);
    assert.equal(anon.status, 401);
    assert.notEqual(anon.json.handler, "legacy");

    const stolen = await hit("POST", `/api/social/notifications/${note.id}/read`, { user: "bob" });
    assert.equal(stolen.status, 404);

    const stolenDel = await hit("DELETE", `/api/social/notifications/${note.id}`, { user: "bob" });
    assert.equal(stolenDel.status, 404);

    const count = await hit("GET", "/api/social/notifications/count", { user: "alice" });
    assert.equal(count.json.handler, undefined);
    assert.ok(count.json.count >= 1);

    const read = await hit("POST", `/api/social/notifications/${note.id}/read`, { user: "alice" });
    assert.equal(read.status, 200);
    const all = await hit("POST", "/api/social/notifications/read-all", { user: "alice" });
    assert.equal(all.json.ok, true);
    const del = await hit("DELETE", `/api/social/notifications/${note.id}`, { user: "alice" });
    assert.equal(del.json.ok, true);
  });

  it("blocks hold on follow, comment, mention, share, and both DM directions", async () => {
    const STATE = globalThis._concordSTATE;
    STATE.socialLens = {
      moderation: new Map([
        ["bob", { muted: new Set(), blocked: new Set(["alice"]) }],
      ]),
    };
    const followed = followUser(STATE, "alice", "bob");
    assert.equal(followed.ok, false);
    assert.equal(followed.status, 403);

    const post = createPost(STATE, { userId: "bob", content: "bob public", privacy: "public", mentionedUsers: ["alice"] });
    const notes = getNotifications(STATE, "alice").notifications.filter((n) => n.type === "mention" && n.postId === post.post.id);
    assert.equal(notes.length, 0);

    const comment = addComment(STATE, { userId: "alice", postId: post.post.id, content: "nope" });
    assert.equal(comment.ok, false);
    const share = sharePost(STATE, { userId: "alice", postId: post.post.id });
    assert.equal(share.ok, false);
    const dm = sendMessage(STATE, { fromUserId: "alice", toUserId: "bob", content: "hey" });
    assert.equal(dm.ok, false);
    const reverse = sendMessage(STATE, { fromUserId: "bob", toUserId: "alice", content: "hey" });
    assert.equal(reverse.ok, false);

    const route = await hit("POST", "/api/social/follow", { user: "alice", body: { followedId: "bob" } });
    assert.equal(route.status, 403);
    assert.notEqual(route.json.handler, "legacy");

    STATE.socialLens.moderation = new Map();
  });

  it("lens sendMessage blocks in both directions and rejects an unknown recipient", () => {
    const STATE = globalThis._concordSTATE;
    const ctxA = { actor: { userId: "alice" }, userId: "alice", db };
    const ctxB = { actor: { userId: "bob" }, userId: "bob", db };
    STATE.socialLens.moderation = new Map([
      ["alice", { muted: new Set(), blocked: new Set(["bob"]) }],
    ]);
    const blocked = call("social.sendMessage", ctxB, { to: "alice", body: "hi" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /blocked/);
    const otherWay = call("social.sendMessage", ctxA, { to: "bob", body: "hi" });
    assert.equal(otherWay.ok, false);
    STATE.socialLens.moderation = new Map();
    const missing = call("social.sendMessage", ctxA, { to: "nobody-real", body: "hi" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /recipient not found/);
  });

  it("listing tags require the post author and the listing owner", async () => {
    const STATE = globalThis._concordSTATE;
    const post = createPost(STATE, { userId: "alice", content: "for sale", privacy: "public" });
    const stranger = await hit("POST", "/api/social-extended/tag-listing", {
      user: "bob",
      body: { postId: post.post.id, listingId: "list_a" },
    });
    assert.equal(stranger.status, 403);
    const notOwner = await hit("POST", "/api/social/commerce/tag", {
      user: "alice",
      body: { postId: post.post.id, listingId: "missing-listing" },
    });
    assert.equal(notOwner.status, 403);
    const ok = await hit("POST", "/api/social/commerce/tag", {
      user: "alice",
      body: { postId: post.post.id, listingId: "list_a" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
  });

  it("cite requires auth and ownership of the citing DTU", async () => {
    const STATE = globalThis._concordSTATE;
    STATE.dtus.set("dtu_alice", { id: "dtu_alice", author: "alice" });
    STATE.dtus.set("dtu_bob", { id: "dtu_bob", author: "bob" });
    const anon = await hit("POST", "/api/social/cite", { body: { citedDtuId: "dtu_bob", citingDtuId: "dtu_alice" } });
    assert.equal(anon.status, 401);
    assert.notEqual(anon.json.handler, "legacy");
    const stolen = await hit("POST", "/api/social/cite", {
      user: "bob",
      body: { citedDtuId: "dtu_bob", citingDtuId: "dtu_alice" },
    });
    assert.equal(stolen.status, 403);
    const ok = await hit("POST", "/api/social/cite", {
      user: "alice",
      body: { citedDtuId: "dtu_bob", citingDtuId: "dtu_alice" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
  });

  it("following activity and creator analytics are the new handlers", async () => {
    const STATE = globalThis._concordSTATE;
    followUser(STATE, "bob", "alice");
    const activity = await hit("GET", "/api/social/following-activity?limit=10", { user: "bob" });
    assert.equal(activity.status, 200);
    assert.notEqual(activity.json.handler, "legacy");
    assert.ok(Array.isArray(activity.json.items));
    assert.ok(activity.json.items.some((item) => item.kind === "post" && item.userId === "alice"));

    const analytics = await hit("GET", "/api/social/analytics/creator", { user: "alice" });
    assert.equal(analytics.status, 200);
    assert.ok(analytics.json.overview);
    assert.equal(analytics.json.creator, undefined);
    assert.equal(analytics.json.engagementByDay, undefined);
    assert.equal(analytics.json.earnings, undefined);

    const topics = await hit("GET", "/api/social/topics/trending");
    assert.equal(topics.status, 200);
    assert.ok(Array.isArray(topics.json.topics));
  });

  it("rejects an unknown REST DM recipient and hides a thread from a non-participant", async () => {
    const missing = await hit("POST", "/api/social/dm", {
      user: "alice",
      body: { toUserId: "ghost", content: "hi" },
    });
    assert.equal(missing.status, 404);
    assert.match(missing.json.error, /recipient not found/);

    const sent = await hit("POST", "/api/social/dm", {
      user: "alice",
      body: { toUserId: "bob", content: "hello bob" },
    });
    assert.equal(sent.status, 200);
    const conv = sent.json.message.conversationId;
    const outsider = await hit("GET", `/api/social/dm/${encodeURIComponent(conv)}`, { user: "carol" });
    // carol has no users row; auth stub still sets req.user. Participant check is the point.
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES ('carol', 'carol', 'carol@ex.test', 'x', 'member', datetime('now'), 1)").run();
    const outsider2 = await hit("GET", `/api/social/dm/${encodeURIComponent(conv)}`, { user: "carol" });
    assert.equal(outsider2.status, 404);
    assert.match(outsider2.json.error, /not a participant/);
    assert.equal(JSON.stringify(outsider2.json).includes("hello bob"), false);
    assert.equal(outsider.status, 404);

    const direct = getMessages(globalThis._concordSTATE, conv, { userId: "carol" });
    assert.equal(direct.status, 404);
    assert.equal(direct.error, "not a participant");
  });

  it("lens conversation and message activity-feed refuse a foreign thread", () => {
    const ctxA = { actor: { userId: "alice", handle: "alice", username: "alice" }, userId: "alice", db, internal: true };
    const ctxC = { actor: { userId: "carol", handle: "carol", username: "carol" }, userId: "carol", db, internal: true };
    const sent = call("social.sendMessage", ctxA, { to: "bob", body: "lens secret" });
    assert.equal(sent.ok, true);
    const foreign = call("social.conversation", ctxC, { threadKey: sent.result.threadKey });
    assert.equal(foreign.ok, false);
    assert.match(foreign.error, /not a participant/);

    const feed = call("message.activity-feed", ctxA, { handle: "bob" });
    assert.equal(feed.ok, false);
    assert.match(String(feed.error), /forbidden/);
  });

  it("files a lens report into the moderation queue", () => {
    const STATE = globalThis._concordSTATE;
    const ctxA = { actor: { userId: "alice" }, userId: "alice", internal: true };
    const post = call("social.createPost", ctxA, { body: "reportable" });
    const report = call("social.report", ctxA, { postId: post.result.post.id, reason: "spam", detail: "this is spam content" });
    assert.equal(report.ok, true);
    assert.equal(report.result.moderation.ok, true);
    const queue = getModerationQueue(STATE, {});
    assert.ok(queue.queue.some((item) => item.contentId === post.result.post.id || item.sampleReport?.contentId === post.result.post.id || JSON.stringify(item).includes(post.result.post.id)));
  });

  it("purges in-memory social records on account deletion", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    createPost(STATE, { userId: "bob", content: "bob stays? no", privacy: "public" });
    sendMessage(STATE, { fromUserId: "bob", toUserId: "alice", content: "keep for alice" });
    STATE.socialLens.posts = new Map([["lp1", { id: "lp1", userId: "bob", body: "lens post" }]]);
    STATE.socialLens.replies = new Map([["lp1", [{ id: "r1", userId: "bob", body: "reply" }]]]);
    const result = executeAccountDeletion(db, "bob");
    assert.equal(result.ok, true);
    assert.equal(STATE._social.profiles.has("bob"), false);
    for (const post of STATE._social.posts.values()) assert.notEqual(post.userId, "bob");
    assert.equal(STATE.socialLens.posts.has("lp1"), false);
    let sawTombstone = false;
    for (const msgs of STATE._social.messages.values()) {
      for (const msg of msgs) {
        if (msg.content === "keep for alice") {
          sawTombstone = true;
          assert.notEqual(msg.fromUserId, "bob");
          assert.match(msg.fromUserId, /^deleted_/);
        }
      }
    }
    assert.equal(sawTombstone, true);
    const purged = purgeUserSocialRecords(STATE, "nobody");
    assert.equal(purged.ok, true);
  });
});
