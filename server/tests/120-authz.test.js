// INC-120 — plugin gallery authorization hole regression.
//
// Fixes pinned:
//   - Only the original author/owner/admin can republish an existing pluginId.
//   - Republishing preserves admin-delisted state (no silent un-delisting).
//   - Ratings are one-per-user-per-plugin (changeable), not a pumpable counter.
//   - Anonymous identities are refused at the library boundary.
//
// Run:
//   cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/120-authz.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  publishPlugin,
  getGalleryEntry,
  listGallery,
  delistPlugin,
  ratePlugin,
  __resetGalleryForTests,
} from "../lib/plugin-gallery.js";

function makeDb() {
  const db = new Database(":memory:");
  return db;
}

function makeCtx(db, userId, role = null) {
  return {
    db,
    actor: {
      userId,
      role,
      isAdmin: ["admin", "owner", "sovereign", "founder"].includes(role),
    },
  };
}

function pluginSource(label) {
  return `export const id = "inc120.${label}"; export const version = "1.0.0";`;
}

describe("INC-120 plugin gallery authorization", () => {
  let db;

  beforeEach(async () => {
    db = makeDb();
    await runMigrations(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it("A publishes; B republishing the same pluginId is refused and A's entry is unchanged", () => {
    const pluginId = "inc120.overwrite-target";
    const ctxA = makeCtx(db, "userA");
    const ctxB = makeCtx(db, "userB");
    const sourceA = pluginSource("a");
    const sourceB = pluginSource("b");

    const first = publishPlugin({
      pluginId, authorId: "userA", source: sourceA, db, ctx: ctxA,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const originalHash = first.plugin.hash;

    const malicious = publishPlugin({
      pluginId, authorId: "userB", source: sourceB, db, ctx: ctxB,
    });
    assert.equal(malicious.ok, false, JSON.stringify(malicious));
    assert.equal(malicious.reason, "forbidden");

    const entry = getGalleryEntry(pluginId);
    assert.equal(entry.ok, true);
    assert.equal(entry.plugin.authorId, "userA");
    assert.equal(entry.plugin.hash, originalHash, "B's publish must not mutate the stored source/hash");
  });

  it("A can republish their own plugin with a new version", () => {
    const pluginId = "inc120.self-update";
    const ctxA = makeCtx(db, "userA");

    const first = publishPlugin({
      pluginId, authorId: "userA", version: "1.0.0", source: pluginSource("v1"), db, ctx: ctxA,
    });
    assert.equal(first.ok, true);

    const second = publishPlugin({
      pluginId, authorId: "userA", version: "2.0.0", source: pluginSource("v2"), db, ctx: ctxA,
    });
    assert.equal(second.ok, true, JSON.stringify(second));

    const entry = getGalleryEntry(pluginId);
    assert.equal(entry.ok, true);
    assert.equal(entry.plugin.authorId, "userA", "authorId must stay unchanged");
    assert.equal(entry.plugin.version, "2.0.0", "version must update");
  });

  it("admin delists a plugin; A republishing keeps it delisted", () => {
    const pluginId = "inc120.delisted-republish";
    const ctxA = makeCtx(db, "userA");

    const pub = publishPlugin({
      pluginId, authorId: "userA", source: pluginSource("delist"), db, ctx: ctxA,
    });
    assert.equal(pub.ok, true);

    const delist = delistPlugin(pluginId, "admin1", "policy_violation", { db });
    assert.equal(delist.ok, true, JSON.stringify(delist));
    assert.ok(delist.plugin.delistedAt, "plugin should be delisted");

    const repub = publishPlugin({
      pluginId, authorId: "userA", version: "1.0.1", source: pluginSource("delist-repub"), db, ctx: ctxA,
    });
    assert.equal(repub.ok, true, JSON.stringify(repub));

    const entry = getGalleryEntry(pluginId);
    assert.equal(entry.ok, true);
    assert.ok(entry.plugin.delistedAt, "republish must not clear admin delisting");

    const listed = listGallery({ search: "inc120.delisted-republish" });
    assert.equal(listed.plugins.length, 0, "delisted plugin must not appear in gallery list");
  });

  it("anonymous publish is refused", () => {
    const pluginId = "inc120.anon-publish";
    const ctxAnon = makeCtx(db, "anon");

    const result = publishPlugin({
      pluginId, authorId: "anon", source: pluginSource("anon"), db, ctx: ctxAnon,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "auth_required");

    const entry = getGalleryEntry(pluginId);
    assert.equal(entry.ok, false, "anonymous publish must not create a gallery entry");
    assert.equal(entry.error, "not_found");
  });

  it("one user cannot pump rating by voting up twice", () => {
    const pluginId = "inc120.rate-pump";
    const ctxA = makeCtx(db, "userA");
    const ctxB = makeCtx(db, "userB");

    publishPlugin({
      pluginId, authorId: "userA", source: pluginSource("rate"), db, ctx: ctxA,
    });

    const first = ratePlugin(pluginId, "userB", "up");
    assert.equal(first.ok, true);
    assert.equal(first.rating.up, 1);
    assert.equal(first.rating.down, 0);

    const second = ratePlugin(pluginId, "userB", "up");
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.rating.up, 1, "duplicate upvote must not increment");
    assert.equal(second.rating.down, 0);
  });

  it("rating changes when a user flips their vote", () => {
    const pluginId = "inc120.rate-flip";
    const ctxA = makeCtx(db, "userA");

    publishPlugin({
      pluginId, authorId: "userA", source: pluginSource("flip"), db, ctx: ctxA,
    });

    ratePlugin(pluginId, "userB", "up");
    const flipped = ratePlugin(pluginId, "userB", "down");
    assert.equal(flipped.ok, true);
    assert.equal(flipped.rating.up, 0);
    assert.equal(flipped.rating.down, 1);
  });

  it("anonymous rating is refused", () => {
    const pluginId = "inc120.anon-rate";
    const ctxA = makeCtx(db, "userA");

    publishPlugin({
      pluginId, authorId: "userA", source: pluginSource("anon-rate"), db, ctx: ctxA,
    });

    const result = ratePlugin(pluginId, "anon", "up");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "auth_required");
  });

  it("B is refused when A's entry has fallen out of the in-memory LRU and the DB row is unchanged", () => {
    const pluginId = "inc120.cache-evict-target";
    const ctxA = makeCtx(db, "userA");
    const ctxB = makeCtx(db, "userB");
    const sourceA = pluginSource("cached-a");
    const sourceB = pluginSource("cached-b");

    const first = publishPlugin({
      pluginId, authorId: "userA", source: sourceA, db, ctx: ctxA,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const originalHash = first.plugin.hash;

    // Simulate LRU eviction or a restart: the in-memory gallery is empty but
    // the DB row still exists.
    __resetGalleryForTests();
    assert.equal(getGalleryEntry(pluginId).ok, false, "in-memory entry should be gone after reset");

    const malicious = publishPlugin({
      pluginId, authorId: "userB", source: sourceB, db, ctx: ctxB,
    });
    assert.equal(malicious.ok, false, JSON.stringify(malicious));
    assert.equal(malicious.reason, "forbidden");

    // The authoritative DB record must still belong to A.
    const row = db.prepare(`SELECT author_id, hash FROM plugin_gallery WHERE plugin_id = ?`).get(pluginId);
    assert.equal(row.author_id, "userA");
    assert.equal(row.hash, originalHash);
  });
});
