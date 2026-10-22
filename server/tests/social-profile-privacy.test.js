// Private profile settings stay with the owner. A stranger, a search
// result, and a logged-out request must not receive them.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialCoreRoutes from "../routes/social-core.js";
import { getProfile, listProfiles, profileForViewer, upsertProfile, canonicalSocial } from "../emergent/social-layer.js";

const PUBLIC_KEYS = new Set([
  "userId", "displayName", "username", "bio", "avatar", "isPublic",
  "specialization", "website", "createdAt", "updatedAt", "stats",
]);

const PRIVATE_KEYS = [
  "email", "recentSearches", "hiddenPosts", "hiddenPostIds", "showLessAuthors",
  "lists", "packs", "followedHashtags", "feedDefault", "keywordMutes",
  "showSensitive", "dmPolicy", "readReceipts", "interests", "notificationTypes",
  "drafts",
];

function requireAuth() {
  return (req, res, next) => {
    const id = req.headers["x-user-id"];
    if (!id) return res.status(401).json({ ok: false, error: "auth required" });
    req.user = { id: String(id) };
    next();
  };
}

function stampPrivate(profile) {
  Object.assign(profile, {
    email: "alice@secret.test",
    recentSearches: ["alice-secret-query"],
    hiddenPosts: ["post_secret"],
    hiddenPostIds: ["post_secret"],
    showLessAuthors: ["bob"],
    lists: [{ id: "list_secret", name: "Quiet" }],
    packs: [{ id: "pack_secret", name: "Night" }],
    followedHashtags: ["secret-tag"],
    feedDefault: "forYou",
    keywordMutes: ["spoilers"],
    showSensitive: true,
    dmPolicy: "nobody",
    readReceipts: false,
    interests: ["private-interest"],
    notificationTypes: { dm: false },
    drafts: [{ content: "draft secret" }],
    internalNote: "not-a-public-field",
  });
}

function assertPublicShape(profile) {
  assert.equal(typeof profile, "object");
  for (const key of Object.keys(profile)) {
    assert.ok(PUBLIC_KEYS.has(key), `unexpected public key ${key}`);
  }
  for (const key of PRIVATE_KEYS) assert.equal(profile[key], undefined, key);
  const blob = JSON.stringify(profile);
  assert.equal(blob.includes("alice@secret.test"), false);
  assert.equal(blob.includes("alice-secret-query"), false);
  assert.equal(blob.includes("private-interest"), false);
  assert.equal(blob.includes("not-a-public-field"), false);
  assert.equal(blob.includes("list_secret"), false);
}

describe("social profile privacy", { concurrency: 1 }, () => {
  let server;
  let base;

  before(async () => {
    const db = new Database(":memory:");
    const STATE = { db, dtus: new Map(), socialLens: { moderation: new Map() } };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};
    upsertProfile(STATE, "alice", { displayName: "Alice", bio: "public bio", isPublic: true });
    upsertProfile(STATE, "bob", { displayName: "Bob", isPublic: true });
    stampPrivate(canonicalSocial(STATE).profiles.get("alice"));

    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialCoreRoutes({ db, requireAuth }));
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

  async function hit(path, user) {
    const res = await fetch(`${base}${path}`, {
      headers: user ? { "x-user-id": user } : {},
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("returns settings to the owner and withholds them from everyone else", () => {
    const STATE = globalThis._concordSTATE;
    const owner = getProfile(STATE, "alice", "alice");
    assert.equal(owner.ok, true);
    assert.equal(owner.profile.dmPolicy, "nobody");
    assert.deepEqual(owner.profile.recentSearches, ["alice-secret-query"]);
    assert.deepEqual(owner.profile.keywordMutes, ["spoilers"]);
    assert.equal(owner.profile.showSensitive, true);
    assert.equal(owner.profile.feedDefault, "forYou");
    assert.deepEqual(owner.profile.interests, ["private-interest"]);
    assert.equal(owner.profile.readReceipts, false);
    assert.deepEqual(owner.profile.notificationTypes, { dm: false });
    assert.equal(owner.profile.email, undefined);
    assert.equal(JSON.stringify(owner.profile).includes("alice@secret.test"), false);

    const stranger = getProfile(STATE, "alice", "bob");
    assert.equal(stranger.ok, true);
    assert.equal(stranger.profile.displayName, "Alice");
    assert.equal(stranger.profile.bio, "public bio");
    assertPublicShape(stranger.profile);

    const anonymous = getProfile(STATE, "alice", null);
    assertPublicShape(anonymous.profile);

    const listed = listProfiles(STATE, { publicOnly: false });
    const alice = listed.profiles.find((row) => row.userId === "alice");
    assertPublicShape(alice);
    assert.equal(profileForViewer(canonicalSocial(STATE).profiles.get("alice"), "bob").dmPolicy, undefined);
  });

  it("GET profile hides settings from a signed-in stranger and refuses a logged-out request", async () => {
    const stranger = await hit("/api/social/profile/alice", "bob");
    assert.equal(stranger.status, 200);
    assert.equal(stranger.json.profile.bio, "public bio");
    assertPublicShape(stranger.json.profile);

    const owner = await hit("/api/social/profile/alice", "alice");
    assert.equal(owner.status, 200);
    assert.equal(owner.json.profile.dmPolicy, "nobody");
    assert.deepEqual(owner.json.profile.lists, [{ id: "list_secret", name: "Quiet" }]);
    assert.equal(owner.json.profile.email, undefined);

    const anon = await hit("/api/social/profile/alice");
    assert.equal(anon.status, 401);
    const blob = JSON.stringify(anon.json);
    assert.equal(blob.includes("alice-secret-query"), false);
    assert.equal(blob.includes("alice@secret.test"), false);
    assert.equal(blob.includes("nobody"), false);
  });

  it("search results do not carry another person's settings", async () => {
    const found = await hit("/api/social/search?q=alice", "bob");
    assert.equal(found.status, 200);
    assert.ok(found.json.people.some((person) => person.id === "alice"));
    const blob = JSON.stringify(found.json);
    assert.equal(blob.includes("alice-secret-query"), false);
    assert.equal(blob.includes("alice@secret.test"), false);
    assert.equal(blob.includes("private-interest"), false);
    assert.equal(blob.includes("keywordMutes"), false);
    assert.equal(blob.includes("dmPolicy"), false);
    assert.equal(blob.includes("showSensitive"), false);
    for (const person of found.json.people) {
      for (const key of PRIVATE_KEYS) assert.equal(person[key], undefined, key);
    }
    assert.deepEqual(found.json.recent, ["alice"]);
  });
});
