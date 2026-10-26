// Social identity (job oc-social-5): accent colour enforcement, profile
// track, and the Showcase shelf — privacy is the point of every test.
// The identity router is mounted inside createSocialEngagementRoutes
// AHEAD of social-core, and stub "legacy" handlers are registered after
// the router, so a 200 with the legacy shape would fail the override
// tests. Showcase reads are re-sanitized per viewer on every fetch: a
// pin whose target later became followers-only, blocked, or expired
// must drop out of the response server-side.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createSocialEngagementRoutes from "../routes/social-engagement.js";
import { createPost, followUser, upsertProfile, canonicalSocial } from "../emergent/social-layer.js";
import { showcaseForViewer, SHOWCASE_MAX } from "../lib/social-identity.js";

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

const PREVIEW_ALICE = JSON.stringify({ previewArtifactId: "art_alice_prev", artist: "Alice", genre: "ambient" });
const PREVIEW_BOB = JSON.stringify({ previewArtifactId: "art_bob_prev", artist: "Bob", genre: "techno" });
const PREVIEW_PLAIN = JSON.stringify({ artist: "Alice", genre: "ambient" });

describe("social identity", { concurrency: 1 }, () => {
  let db;
  let server;
  let base;

  function addListing(id, sellerId, contentType, status, previewData, price) {
    db.prepare(
      `INSERT INTO marketplace_economy_listings
        (id, seller_id, content_id, content_type, title, description, price, content_hash,
         status, preview_type, license_type, royalty_chain_json, preview_data,
         purchase_count, total_revenue, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, '', ?, 'hash', ?, 'audio', 'standard', '[]', ?, 0, 0, datetime('now'), datetime('now'))`,
    ).run(id, sellerId, contentType, `Track ${id}`, price, status, previewData);
  }

  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT,
        role TEXT, created_at TEXT, is_active INTEGER DEFAULT 1
      );
      CREATE TABLE marketplace_economy_listings (
        id TEXT PRIMARY KEY, seller_id TEXT, content_id TEXT, content_type TEXT,
        title TEXT, description TEXT, price REAL, content_hash TEXT, status TEXT,
        preview_type TEXT, license_type TEXT, royalty_chain_json TEXT, preview_data TEXT,
        purchase_count INTEGER DEFAULT 0, total_revenue REAL DEFAULT 0,
        created_at TEXT, updated_at TEXT
      );
    `);
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES ('alice', 'alice', 'alice@ex.test', 'x', 'member', datetime('now'), 1)").run();
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at, is_active) VALUES ('bob', 'bob', 'bob@ex.test', 'x', 'member', datetime('now'), 1)").run();

    // The caller's own published track (with a public preview stream), a
    // preview-less listing, an unpublished draft, a stranger's track, and
    // a non-music listing.
    addListing("lst_alice_track", "alice", "music", "active", PREVIEW_ALICE, 1200);
    addListing("lst_alice_plain", "alice", "music", "active", PREVIEW_PLAIN, 900);
    addListing("lst_alice_draft", "alice", "music", "draft", PREVIEW_ALICE, 700);
    addListing("lst_bob_track", "bob", "music", "active", PREVIEW_BOB, 500);
    addListing("lst_alice_image", "alice", "image", "active", PREVIEW_ALICE, 300);

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
    // Stub "legacy" handlers for the exact paths the identity router
    // overrides — mounted AFTER the router, so a 200 from these would
    // mean the override is broken.
    app.post("/api/social/profile", legacy);
    app.get("/api/social/profile/:userId", legacy);

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

  function profiles() {
    return canonicalSocial(globalThis._concordSTATE).profiles;
  }

  function establish(userId) {
    // This suite writes more identity state than a brand-new account is
    // allowed to. The accounts under test are established.
    if (profiles().get(userId)) profiles().get(userId).createdAt = "2020-01-01T00:00:00.000Z";
  }

  it("POST /profile is the new handler: saves the standard fields plus a validated accent", async () => {
    const saved = await hit("POST", "/api/social/profile", {
      user: "alice",
      body: { displayName: "Alice", bio: "sound of the commons", isPublic: true, accent: "#14B8A6" },
    });
    assert.equal(saved.status, 200);
    assert.notEqual(saved.json.handler, "legacy");
    assert.equal(saved.json.ok, true);
    assert.equal(saved.json.accent, "#14b8a6"); // normalized to lowercase
    assert.equal(saved.json.profile.displayName, "Alice");

    const read = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.notEqual(read.json.handler, "legacy");
    assert.equal(read.json.profile.accent, "#14b8a6");
    establish("alice");
  });

  it("accent contrast is enforced server-side and a failed accent saves nothing", async () => {
    // #767676 is ~4.10:1 against the dark surface — under the 4.5:1 bar.
    const tooDim = await hit("POST", "/api/social/profile", {
      user: "alice",
      body: { displayName: "Should Not Save", accent: "#767676" },
    });
    assert.equal(tooDim.status, 400);
    assert.match(tooDim.json.error, /4\.5:1/);

    const notHex = await hit("POST", "/api/social/profile", {
      user: "alice",
      body: { displayName: "Should Not Save", accent: "chartreuse" },
    });
    assert.equal(notHex.status, 400);
    assert.match(notHex.json.error, /hex colour/);

    const anon = await hit("POST", "/api/social/profile", { body: { accent: "#ffffff" } });
    assert.equal(anon.status, 401);

    // All-or-nothing: the displayName from the failed saves never landed.
    const read = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.equal(read.json.profile.displayName, "Alice");
    assert.equal(read.json.profile.accent, "#14b8a6");
  });

  it("a brand-new profile can be created with an accent in the same request, and cleared with null", async () => {
    const firstSave = await hit("POST", "/api/social/profile", {
      user: "carol",
      body: { displayName: "Carol", isPublic: true, accent: "#FFFFFF" },
    });
    assert.equal(firstSave.status, 200);
    assert.equal(firstSave.json.accent, "#ffffff");

    const cleared = await hit("POST", "/api/social/profile", {
      user: "carol",
      body: { displayName: "Carol", accent: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.accent, null);
    const read = await hit("GET", "/api/social/profile/carol", { user: "carol" });
    assert.equal(read.json.profile.accent, null);
    establish("carol");
  });

  it("track options are only the caller's own published music with a public preview stream", async () => {
    const mine = await hit("GET", "/api/social/identity/track-options", { user: "alice" });
    assert.equal(mine.status, 200);
    assert.deepEqual(
      mine.json.options.map((o) => o.listingId),
      ["lst_alice_track"],
    );
    assert.equal(mine.json.options[0].artist, "Alice");
    assert.equal(mine.json.options[0].genre, "ambient");

    const bobs = await hit("GET", "/api/social/identity/track-options", { user: "bob" });
    assert.deepEqual(
      bobs.json.options.map((o) => o.listingId),
      ["lst_bob_track"],
    );

    const anon = await hit("GET", "/api/social/identity/track-options");
    assert.equal(anon.status, 401);
  });

  it("the profile track must be the caller's own active listing with a preview stream", async () => {
    const stolen = await hit("POST", "/api/social/identity/track", { user: "alice", body: { listingId: "lst_bob_track" } });
    assert.equal(stolen.status, 403);
    assert.match(stolen.json.error, /only feature your own tracks/);

    const draft = await hit("POST", "/api/social/identity/track", { user: "alice", body: { listingId: "lst_alice_draft" } });
    assert.equal(draft.status, 400);
    assert.match(draft.json.error, /published \(active\)/);

    const previewless = await hit("POST", "/api/social/identity/track", { user: "alice", body: { listingId: "lst_alice_plain" } });
    assert.equal(previewless.status, 400);
    assert.match(previewless.json.error, /no public preview stream/);

    const missing = await hit("POST", "/api/social/identity/track", { user: "alice", body: { listingId: "lst_nope" } });
    assert.equal(missing.status, 404);

    const set = await hit("POST", "/api/social/identity/track", { user: "alice", body: { listingId: "lst_alice_track" } });
    assert.equal(set.status, 200);
    assert.equal(set.json.track.listingId, "lst_alice_track");
    assert.equal(set.json.track.title, "Track lst_alice_track");
    // Playback URL is the listing's PUBLIC preview stream — never /master.
    assert.equal(set.json.track.previewUrl, "/api/economy/marketplace/listings/lst_alice_track/preview");
    assert.equal(set.json.track.previewUrl.includes("master"), false);

    const onProfile = await hit("GET", "/api/social/profile/alice", { user: "bob" });
    assert.equal(onProfile.json.profile.profileTrack.previewUrl, "/api/economy/marketplace/listings/lst_alice_track/preview");
  });

  it("a delisted track disappears from every profile read — re-validated, not remembered", async () => {
    db.prepare("UPDATE marketplace_economy_listings SET status = 'delisted' WHERE id = 'lst_alice_track'").run();
    const read = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.equal(read.json.profile.profileTrack, null);

    // Un-deleting brings it back — the pin survived, the read is honest.
    db.prepare("UPDATE marketplace_economy_listings SET status = 'active' WHERE id = 'lst_alice_track'").run();
    const restored = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.equal(restored.json.profile.profileTrack.listingId, "lst_alice_track");
  });

  it("showcase pins are own/public/with-media (posts) and own/active (listings)", async () => {
    const STATE = globalThis._concordSTATE;
    establish("bob");
    const pubMedia = createPost(STATE, { userId: "alice", content: "studio render", privacy: "public", mediaType: "image", mediaUrl: "/api/artifact/x/stream" });
    const followersMedia = createPost(STATE, { userId: "alice", content: "secret render", privacy: "followers", mediaType: "image", mediaUrl: "/api/artifact/y/stream" });
    const textOnly = createPost(STATE, { userId: "alice", content: "just words", privacy: "public" });
    const bobMedia = createPost(STATE, { userId: "bob", content: "bob render", privacy: "public", mediaType: "image", mediaUrl: "/api/artifact/z/stream" });
    assert.equal(pubMedia.ok, true);
    assert.equal(followersMedia.ok, true);
    assert.equal(textOnly.ok, true);
    assert.equal(bobMedia.ok, true);

    const okPost = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "post", id: pubMedia.post.id } });
    assert.equal(okPost.status, 200);
    assert.equal(okPost.json.count, 1);

    const followers = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "post", id: followersMedia.post.id } });
    assert.equal(followers.status, 400);
    assert.match(followers.json.error, /Only public posts/);

    const noMedia = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "post", id: textOnly.post.id } });
    assert.equal(noMedia.status, 400);
    assert.match(noMedia.json.error, /Only posts with media/);

    const stolen = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "post", id: bobMedia.post.id } });
    assert.equal(stolen.status, 403);
    assert.match(stolen.json.error, /only pin your own creations/);

    const okListing = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "listing", id: "lst_alice_image" } });
    assert.equal(okListing.status, 200);

    const stolenListing = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "listing", id: "lst_bob_track" } });
    assert.equal(stolenListing.status, 403);

    const draftListing = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "listing", id: "lst_alice_draft" } });
    assert.equal(draftListing.status, 400);
    assert.match(draftListing.json.error, /Only published listings/);

    const badKind = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "story", id: "whatever" } });
    assert.equal(badKind.status, 400);
    assert.match(badKind.json.error, /kind must be post or listing/);

    const duplicate = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "post", id: pubMedia.post.id } });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.json.error, /Already pinned/);

    const anon = await hit("POST", "/api/social/identity/showcase/pin", { body: { kind: "post", id: pubMedia.post.id } });
    assert.equal(anon.status, 401);
  });

  it("the showcase hard cap is 6, unpin is honest, reorder must be an exact permutation", async () => {
    addListing("lst_fill_1", "alice", "image", "active", null, 100);
    addListing("lst_fill_2", "alice", "image", "active", null, 100);
    addListing("lst_fill_3", "alice", "image", "active", null, 100);
    addListing("lst_fill_4", "alice", "image", "active", null, 100);
    addListing("lst_fill_5", "alice", "image", "active", null, 100);

    for (const id of ["lst_fill_1", "lst_fill_2", "lst_fill_3", "lst_fill_4"]) {
      const pinned = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "listing", id } });
      assert.equal(pinned.status, 200);
    }
    // 2 pins from the previous test + 4 here = 6: the cap.
    const seventh = await hit("POST", "/api/social/identity/showcase/pin", { user: "alice", body: { kind: "listing", id: "lst_fill_5" } });
    assert.equal(seventh.status, 400);
    assert.match(seventh.json.error, new RegExp(`Showcase is full \\(max ${SHOWCASE_MAX}\\)`));

    const options = await hit("GET", "/api/social/identity/showcase/options", { user: "alice" });
    assert.equal(options.status, 200);
    assert.equal(options.json.options.filter((o) => o.alreadyPinned).length, SHOWCASE_MAX);

    const unpinned = await hit("DELETE", "/api/social/identity/showcase/listing/lst_fill_4", { user: "alice" });
    assert.equal(unpinned.status, 200);
    assert.equal(unpinned.json.count, 5);
    const again = await hit("DELETE", "/api/social/identity/showcase/listing/lst_fill_4", { user: "alice" });
    assert.equal(again.status, 404);
    assert.match(again.json.error, /Not pinned/);

    const before = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    const ids = before.json.profile.showcase.map((pin) => `${pin.kind}:${pin.id}`);
    const moved = [ids[ids.length - 1], ...ids.slice(0, -1)].map((key) => {
      const [kind, id] = key.split(":");
      return { kind, id };
    });
    const reordered = await hit("POST", "/api/social/identity/showcase/reorder", { user: "alice", body: { order: moved } });
    assert.equal(reordered.status, 200);
    const after = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.deepEqual(
      after.json.profile.showcase.map((pin) => `${pin.kind}:${pin.id}`),
      moved.map((entry) => `${entry.kind}:${entry.id}`),
    );

    const partial = await hit("POST", "/api/social/identity/showcase/reorder", { user: "alice", body: { order: moved.slice(0, 2) } });
    assert.equal(partial.status, 400);
    assert.match(partial.json.error, /exactly once/);
  });

  it("showcase reads are re-sanitized per viewer: privacy flips, blocks, and expiry drop pins server-side", async () => {
    const STATE = globalThis._concordSTATE;
    const social = canonicalSocial(STATE);
    // Find the one pinned post from earlier.
    const aliceProfile = social.profiles.get("alice");
    const pinnedPostKey = (aliceProfile.showcase || []).find((pin) => pin.kind === "post");
    assert.ok(pinnedPostKey, "the public media post is pinned");
    const post = social.posts.get(pinnedPostKey.id);
    const pinnedListingCount = aliceProfile.showcase.filter((pin) => pin.kind === "listing").length;

    // The owner later restricts the pinned post to followers-only.
    post.privacy = "followers";

    const asStranger = await hit("GET", "/api/social/profile/alice", { user: "bob" });
    const strangerIds = asStranger.json.profile.showcase.map((pin) => `${pin.kind}:${pin.id}`);
    assert.equal(strangerIds.includes(`post:${post.id}`), false, "a followers-only pin is hidden from a stranger");
    assert.equal(asStranger.json.profile.showcase.length, pinnedListingCount, "listing pins survive the privacy flip");

    // A follower sees it again.
    followUser(STATE, "bob", "alice");
    const asFollower = await hit("GET", "/api/social/profile/alice", { user: "bob" });
    assert.equal(
      asFollower.json.profile.showcase.some((pin) => pin.kind === "post" && pin.id === post.id),
      true,
      "a follower sees the followers-only pin",
    );

    // A block hides the author's pins from the blocking viewer.
    STATE.socialLens.moderation = new Map([
      ["bob", { muted: new Set(), blocked: new Set(["alice"]) }],
    ]);
    const asBlocked = await hit("GET", "/api/social/profile/alice", { user: "bob" });
    assert.equal(
      asBlocked.json.profile.showcase.some((pin) => pin.kind === "post" && pin.id === post.id),
      false,
      "a blocked viewer loses the post pins",
    );
    STATE.socialLens.moderation = new Map();

    // The author restricts it back to public, then the post expires:
    // invisible to everyone, author included.
    post.privacy = "public";
    post.expiresAt = "2020-01-01T00:00:00.000Z";
    const asAuthor = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.equal(
      asAuthor.json.profile.showcase.some((pin) => pin.kind === "post" && pin.id === post.id),
      false,
      "an expired pin is hidden from the author too",
    );
    post.expiresAt = null;

    // Anonymous callers are refused by the auth-gated route, and the
    // pure sanitizer drops non-public pins for a null viewer as well.
    const anon = await hit("GET", "/api/social/profile/alice");
    assert.equal(anon.status, 401);
    post.privacy = "followers";
    const anonView = showcaseForViewer(STATE, aliceProfile, null, db);
    assert.equal(anonView.some((pin) => pin.kind === "post" && pin.id === post.id), false);
    post.privacy = "public";
  });

  it("a stranger's profile response carries public identity but never private settings", async () => {
    const social = canonicalSocial(globalThis._concordSTATE);
    const alice = social.profiles.get("alice");
    // Settings that must never cross the #1435 allowlist.
    alice.email = "alice@private.test";
    alice.dmPolicy = "nobody";
    alice.muted = ["bob"];

    const asStranger = await hit("GET", "/api/social/profile/alice", { user: "bob" });
    const profile = asStranger.json.profile;
    assert.equal(typeof profile.accent, "string");
    assert.ok(Array.isArray(profile.showcase));
    assert.ok(profile.profileTrack && profile.profileTrack.listingId === "lst_alice_track");
    const serialized = JSON.stringify(asStranger.json);
    assert.equal(serialized.includes("alice@private.test"), false, "email never leaves");
    assert.equal(profile.dmPolicy, undefined);
    assert.equal(profile.muted, undefined);

    // The owner sees their own private settings — but still no email.
    const asOwner = await hit("GET", "/api/social/profile/alice", { user: "alice" });
    assert.equal(asOwner.json.profile.dmPolicy, "nobody");
    assert.equal(JSON.stringify(asOwner.json).includes("alice@private.test"), false);
  });
});