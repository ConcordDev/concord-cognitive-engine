// Welcome-pass privacy (job oc-social-3b): people-to-follow visibility,
// welcome-state/dismiss ownership and persistence, and the discover
// override. The router is mounted ahead of stub "legacy" handlers so a
// 200 from a legacy shape would fail the override tests.
//
// The privacy bar every suggestion is held to: a creator is only ever
// suggested on the strength of PUBLIC posts (followers-only/private
// posts never qualify), blocks count in either direction, mutes are the
// viewer's own, and an anonymous caller gets 401 on all four routes.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import { up as canonicalStoreMigration } from "../migrations/482_social_canonical_store.js";
import {
  createPost,
  followUser,
  upsertProfile,
  canonicalSocial,
} from "../emergent/social-layer.js";
import { flushSocialStore, ensureSocialHydrated } from "../lib/social-persist.js";
import { peopleToFollow, welcomeState, dismissWelcome } from "../lib/social-welcome.js";

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

// kim is deliberately NOT in this list — the ghost case: no users row, no
// social profile, never suggested and never dismissible.
const USERS = ["alice", "bob", "carol", "dave", "eve", "frank", "gina", "hank", "mallory"];

describe("social welcome privacy", { concurrency: 1 }, () => {
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
      CREATE TABLE route_studio_projects (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, description TEXT,
        status TEXT, created_by TEXT, created_at TEXT, updated_at TEXT
      );
    `);
    canonicalStoreMigration(db); // persistence tables for the dismissal round-trip
    for (const id of USERS) {
      db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES (?, ?, ?, 'x', 'member', datetime('now'), 1)")
        .run(id, id, `${id}@ex.test`);
    }

    const STATE = { db, dtus: new Map(), socialLens: {} };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};

    // Established accounts — this suite posts more than a brand-new account allows.
    for (const id of USERS) upsertProfile(STATE, id, { displayName: id, isPublic: true });
    for (const profile of canonicalSocial(STATE).profiles.values()) profile.createdAt = "2020-01-01T00:00:00.000Z";

    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialEngagementRoutes({ db, requireAuth }));
    // Registered AFTER the router: first registration wins, so a 200 here
    // with handler:"legacy" would mean an override failed to take.
    for (const [method, path] of [
      ["get", "/api/social/discover/:userId"],
      ["get", "/api/social/people-to-follow"],
      ["get", "/api/social/welcome-state"],
      ["post", "/api/social/welcome-dismiss"],
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

  it("all four welcome routes require auth and are the new handlers, not legacy", async () => {
    const anonPeople = await hit("GET", "/api/social/people-to-follow");
    assert.equal(anonPeople.status, 401);
    assert.notEqual(anonPeople.json.handler, "legacy");

    const anonState = await hit("GET", "/api/social/welcome-state");
    assert.equal(anonState.status, 401);

    const anonDismiss = await hit("POST", "/api/social/welcome-dismiss");
    assert.equal(anonDismiss.status, 401);

    // The legacy /discover handler was public; the override is not — an
    // anonymous caller can no longer read suggestions.
    const anonDiscover = await hit("GET", "/api/social/discover/alice");
    assert.equal(anonDiscover.status, 401);
    assert.notEqual(anonDiscover.json.handler, "legacy");

    const people = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    assert.equal(people.status, 200);
    assert.equal(people.json.handler, undefined);
    assert.equal(people.json.ok, true);

    const discover = await hit("GET", "/api/social/discover/alice", { user: "alice" });
    assert.equal(discover.status, 200);
    assert.equal(discover.json.handler, undefined);
    assert.equal(discover.json.ok, true);
  });

  it("only recent PUBLIC posts qualify a creator — followers-only and private never do", async () => {
    const STATE = globalThis._concordSTATE;
    createPost(STATE, { userId: "bob", content: "bob public", privacy: "public" });
    createPost(STATE, { userId: "carol", content: "carol followers only", privacy: "followers" });
    createPost(STATE, { userId: "carol", content: "carol private", privacy: "private" });
    // The viewer's own posts never self-suggest.
    createPost(STATE, { userId: "alice", content: "alice public", privacy: "public" });
    // kim has no users row and no profile — no honest name, never suggested.
    createPost(STATE, { userId: "kim", content: "ghost post", privacy: "public" });

    const res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    assert.equal(res.status, 200);
    const ids = res.json.people.map((p) => p.userId);
    assert.ok(ids.includes("bob"), "public poster suggested");
    assert.ok(!ids.includes("carol"), "followers-only/private-only author never qualifies");
    assert.ok(!ids.includes("alice"), "viewer never suggested to themselves");
    assert.ok(!ids.includes("kim"), "no honest name — never suggested");

    const bob = res.json.people.find((p) => p.userId === "bob");
    assert.equal(bob.recentPostCount, 1);
    assert.equal(bob.displayName, "bob");

    // The stranger bar holds the other way too: carol's hidden content
    // never leaks through the suggestion payload.
    assert.equal(JSON.stringify(res.json).includes("carol followers only"), false);
  });

  it("excludes followed, blocked (either direction), muted, stale and expired activity", async () => {
    const STATE = globalThis._concordSTATE;
    // Fresh qualifying posts for each exclusion case.
    createPost(STATE, { userId: "frank", content: "frank public", privacy: "public" });
    createPost(STATE, { userId: "gina", content: "gina stale", privacy: "public" });
    createPost(STATE, { userId: "hank", content: "hank expiring", privacy: "public" });
    createPost(STATE, { userId: "mallory", content: "mallory public", privacy: "public" });

    const social = canonicalSocial(STATE);
    // gina's only activity is 40 days old — outside the window.
    for (const post of social.posts.values()) {
      if (post.userId === "gina") post.createdAt = new Date(Date.now() - 40 * 86400000).toISOString();
      // hank's post expired.
      if (post.userId === "hank") post.expiresAt = new Date(Date.now() - 86400000).toISOString();
    }

    followUser(STATE, "alice", "frank");

    let res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    let ids = res.json.people.map((p) => p.userId);
    assert.ok(!ids.includes("gina"), "stale-only creator not suggested");
    assert.ok(!ids.includes("hank"), "expired post does not qualify");
    assert.ok(!ids.includes("frank"), "already-followed account not suggested");

    // alice blocks mallory — either direction hides.
    STATE.socialLens.moderation = new Map([
      ["alice", { muted: new Set(), blocked: new Set(["mallory"]) }],
    ]);
    res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    ids = res.json.people.map((p) => p.userId);
    assert.ok(!ids.includes("mallory"), "viewer-blocked account not suggested");
    assert.equal(JSON.stringify(res.json).includes("mallory public"), false);

    // Reverse direction: mallory blocks alice — mallory still never appears.
    STATE.socialLens.moderation = new Map([
      ["mallory", { muted: new Set(), blocked: new Set(["alice"]) }],
    ]);
    res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    ids = res.json.people.map((p) => p.userId);
    assert.ok(!ids.includes("mallory"), "block in either direction hides");

    // Muted (viewer's own list) — bob from the previous test is muted now.
    STATE.socialLens.moderation = new Map([
      ["alice", { muted: new Set(["bob"]), blocked: new Set() }],
    ]);
    res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    ids = res.json.people.map((p) => p.userId);
    assert.ok(!ids.includes("bob"), "muted account not suggested");

    STATE.socialLens.moderation = new Map();
  });

  it("private Studio projects never qualify a creator or show a count", async () => {
    db.prepare(
      `INSERT INTO route_studio_projects (id, name, type, description, status, created_by, created_at, updated_at)
       VALUES ('sp_dave', 'Done track', 'track', '', 'complete', 'dave', datetime('now'), datetime('now'))`
    ).run();
    const res = await hit("GET", "/api/social/people-to-follow?limit=12", { user: "alice" });
    const ids = res.json.people.map((p) => p.userId);
    assert.ok(!ids.includes("dave"), "studio work alone (no public posts) does not qualify");
    for (const p of res.json.people) assert.equal(p.studioReleaseCount, undefined);
  });

  it("welcome-state reflects only the session user's real profile and posts", async () => {
    const STATE = globalThis._concordSTATE;
    const fresh = await hit("GET", "/api/social/welcome-state", { user: "dave" });
    assert.equal(fresh.status, 200);
    assert.deepEqual(fresh.json, { ok: true, hasAvatar: false, hasBio: false, hasFirstPost: false, dismissed: false });

    upsertProfile(STATE, "dave", { avatar: "https://cdn.ex.test/a.png", bio: "producer" });
    createPost(STATE, { userId: "dave", content: "first!", privacy: "public" });

    const done = await hit("GET", "/api/social/welcome-state", { user: "dave" });
    assert.equal(done.json.hasAvatar, true);
    assert.equal(done.json.hasBio, true);
    assert.equal(done.json.hasFirstPost, true);

    // Per-user: eve sees none of dave's progress.
    const eve = await hit("GET", "/api/social/welcome-state", { user: "eve" });
    assert.equal(eve.json.hasFirstPost, false);
    assert.equal(eve.json.dismissed, false);
  });

  it("dismissal requires a profile, is per-user, and persists server-side", async () => {
    const STATE = globalThis._concordSTATE;
    const noProfile = await hit("POST", "/api/social/welcome-dismiss", { user: "kim" });
    assert.equal(noProfile.status, 404);
    assert.equal(noProfile.json.ok, false);

    const ok = await hit("POST", "/api/social/welcome-dismiss", { user: "carol" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);

    const mine = await hit("GET", "/api/social/welcome-state", { user: "carol" });
    assert.equal(mine.json.dismissed, true);

    // Someone else's dismissal never touches another user's state.
    const other = await hit("GET", "/api/social/welcome-state", { user: "bob" });
    assert.equal(other.json.dismissed, false);

    // The flag is on the canonical profile, which round-trips through
    // payload_json — a restart keeps the dismissal.
    flushSocialStore(STATE);
    const STATE2 = { db, dtus: new Map(), socialLens: {} };
    canonicalSocial(STATE2); // empty in-memory store
    ensureSocialHydrated(STATE2);
    const reloaded = canonicalSocial(STATE2).profiles.get("carol");
    assert.ok(reloaded, "carol's profile survived the restart");
    assert.equal(reloaded.welcomeDismissed, true);
  });

  it("discover override serves the SESSION user's view, never the param", async () => {
    const STATE = globalThis._concordSTATE;
    // mallory has a DTU interest overlapping carol's specialization — a
    // param-trusted implementation would suggest carol here.
    STATE.dtus.set("dtu_mallory", { id: "dtu_mallory", author: "mallory", tags: ["synth"] });
    upsertProfile(STATE, "carol", { specialization: ["synth"] });

    // alice has NO interest signal: her own view falls back to active
    // creators from public posts (bob, dave, …) — not mallory's overlap.
    const res = await hit("GET", "/api/social/discover/mallory", { user: "alice" });
    assert.equal(res.status, 200);
    assert.equal(res.json.handler, undefined);
    const ids = res.json.suggestions.map((s) => s.userId);
    assert.ok(!ids.includes("carol"), "param user's interest view never served to another session");
    assert.ok(ids.includes("bob"), "fallback surfaces real active creators");

    // Blocked and muted users never appear in suggestions for the session
    // user either.
    STATE.socialLens.moderation = new Map([
      ["alice", { muted: new Set(["bob"]), blocked: new Set(["dave"]) }],
    ]);
    const filtered = await hit("GET", "/api/social/discover/alice", { user: "alice" });
    const filteredIds = filtered.json.suggestions.map((s) => s.userId);
    assert.ok(!filteredIds.includes("bob"), "muted account never suggested");
    assert.ok(!filteredIds.includes("dave"), "blocked account never suggested");

    STATE.socialLens.moderation = new Map();
    STATE.dtus.delete("dtu_mallory");
  });

  it("direct helpers refuse anonymous callers with 401", () => {
    const STATE = globalThis._concordSTATE;
    assert.equal(peopleToFollow(STATE, { viewerId: null }).status, 401);
    assert.equal(welcomeState(STATE, null).status, 401);
    assert.equal(dismissWelcome(STATE, null).status, 401);
  });
});