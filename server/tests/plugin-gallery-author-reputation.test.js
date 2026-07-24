// server/tests/plugin-gallery-author-reputation.test.js
//
// SDK-H — author identity/reputation badge for the plugin gallery.
//
// Contract: every gallery entry (`listGallery` / `getGalleryEntry`) carries
// an `authorReputationSummary` computed by reusing the REAL, already-shipped
// reputation system — never a parallel/invented one:
//   - `profile.reputation-summary` (server/domains/profile.js, V1.2 Wave A,
//     peer-visible via `targetUserId`) reached through an injected
//     `getAuthorReputation(authorId)` callback (the same shape server.js
//     wires it with in production);
//   - `listBadges` (server/lib/reputation-badges.js) — real granted tiered
//     badges, read directly (no callback needed).
//
// This is deliberately a SEPARATE signal from the gallery's own self-attested
// `trusted`/`trustDescription` (plugin-signing.js) — this suite only proves
// the reputation side; plugin-gallery-disclosure.test.js already pins the
// trust-labeling side untouched.
//
// Uses a REAL in-memory better-sqlite3 DB with real migrations applied (same
// pattern as profile-peer-view.test.js) so the peer-view visibility scoping
// is genuinely exercised through the callback, not assumed.
//
// Run: node --test --test-force-exit --test-timeout=60000 server/tests/plugin-gallery-author-reputation.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrateCore } from "../migrations/001_core_tables.js";
import { up as migrateCreatorId } from "../migrations/087_dtus_type_creator_data.js";
import { up as migrateDtuCitations } from "../migrations/010_learning_verification.js";

import registerProfileActions from "../domains/profile.js";
import { publishPlugin, listGallery, getGalleryEntry } from "../lib/plugin-gallery.js";
import { evaluateBadges } from "../lib/reputation-badges.js";

// ── profile.reputation-summary shim (same pattern as profile-peer-view.test.js) ──
const PROFILE_HANDLERS = new Map();
registerProfileActions((_domain, action, fn) => PROFILE_HANDLERS.set(action, fn));

let DB;
let callCount;

// The exact callback shape server.js wires into plugin-gallery.js — reaches
// the REAL profile.reputation-summary handler with a REAL db, peer-view
// (targetUserId = the author, caller is some other synthetic id).
function getAuthorReputation(authorId) {
  callCount++;
  return PROFILE_HANDLERS.get("reputation-summary")(
    { actor: { userId: "gallery-lookup-caller" }, db: DB },
    { data: {} },
    { targetUserId: authorId },
  );
}

function freshDb() {
  const db = new Database(":memory:");
  migrateCore(db);
  migrateCreatorId(db);
  migrateDtuCitations(db);
  return db;
}

function ensureUser(db, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(userId, userId, `${userId}@example.test`);
}

function insertDtu(db, { id, creatorId, title, visibility = "public" }) {
  ensureUser(db, creatorId);
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', '[]', ?, 'regular', datetime('now'), datetime('now'))
  `).run(id, creatorId, creatorId, title, visibility);
}

function insertCitations(db, dtuId, count) {
  db.prepare(`
    INSERT INTO dtu_citations (dtu_id, citation_count, first_cited, last_cited)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `).run(dtuId, count);
}

function pub(pluginId, authorId) {
  const source = `
    export const id = "${pluginId.replace(/\./g, "_")}";
    export const name = "${pluginId}";
    export const version = "1.0.0";
    export function init(ctx) { return { ok: true }; }
    export function destroy() {}
    export const macros = {};
  `;
  return publishPlugin({ pluginId, authorId, source });
}

beforeEach(() => {
  DB = freshDb();
  callCount = 0;
});

describe("plugin gallery — authorReputationSummary is present and honest", () => {
  it("an author with zero DTU/citation/badge activity gets an honest no-history state, never a fabricated tier", () => {
    pub("gallery.rep-empty", "author-empty");
    const entry = getGalleryEntry("gallery.rep-empty", null, { getAuthorReputation });
    const s = entry.plugin.authorReputationSummary;
    assert.equal(s.authorId, "author-empty");
    assert.equal(s.available, true, "the profile handler DID resolve — this is honest-zero, not unavailable");
    assert.equal(s.hasActivity, false);
    assert.equal(s.totalCitations, 0);
    assert.equal(s.dtuCount, 0);
    assert.deepEqual(s.reputationDomains, []);
    assert.deepEqual(s.badges, []);
    assert.equal(s.topBadge, null);
  });

  it("an author with real DTUs + citations surfaces the REAL counts, not invented ones", () => {
    insertDtu(DB, { id: "d1", creatorId: "author-active", title: "Beam Frame Solver" });
    insertDtu(DB, { id: "d2", creatorId: "author-active", title: "CAS Notes" });
    insertCitations(DB, "d1", 7);
    insertCitations(DB, "d2", 3);
    pub("gallery.rep-active", "author-active");

    const entry = getGalleryEntry("gallery.rep-active", null, { getAuthorReputation });
    const s = entry.plugin.authorReputationSummary;
    assert.equal(s.available, true);
    assert.equal(s.hasActivity, true);
    assert.equal(s.dtuCount, 2);
    assert.equal(s.totalCitations, 10);
    assert.ok(s.reputationDomains.length > 0, "real activity should populate the deterministic reputation domains");
  });

  it("reuses the REAL peer-view visibility scoping — a private DTU's citations never leak into the gallery badge", () => {
    insertDtu(DB, { id: "priv1", creatorId: "author-mixed", title: "Secret Ledger", visibility: "private" });
    insertDtu(DB, { id: "pub1", creatorId: "author-mixed", title: "Public Dome", visibility: "public" });
    insertCitations(DB, "priv1", 500); // large private-only count must not leak
    insertCitations(DB, "pub1", 4);
    pub("gallery.rep-mixed", "author-mixed");

    const entry = getGalleryEntry("gallery.rep-mixed", null, { getAuthorReputation });
    const s = entry.plugin.authorReputationSummary;
    assert.equal(s.dtuCount, 1, "only the public DTU is visible to a stranger");
    assert.equal(s.totalCitations, 4, "the private DTU's 500 citations must never leak");
  });

  it("a real granted badge (reputation-badges.js) surfaces as topBadge, independent of the DB-backed summary", () => {
    evaluateBadges({ userId: "author-badged", citationsReceived: 30 }); // crosses bronze(5) + silver(25)
    pub("gallery.rep-badged", "author-badged");

    const entry = getGalleryEntry("gallery.rep-badged", null, { getAuthorReputation: null }); // no callback at all
    const s = entry.plugin.authorReputationSummary;
    assert.equal(s.available, false, "no callback was supplied — the DB-backed half is honestly unavailable");
    assert.equal(s.hasActivity, true, "a real badge alone counts as activity");
    assert.ok(s.badges.length >= 2);
    assert.equal(s.topBadge.category, "citations_received");
    assert.equal(s.topBadge.tier, "silver");
  });

  it("no reputation callback and no badges yields a fully honest empty state (not an error)", () => {
    pub("gallery.rep-nothing", "author-nothing");
    const entry = getGalleryEntry("gallery.rep-nothing", null, {});
    const s = entry.plugin.authorReputationSummary;
    assert.equal(s.available, false);
    assert.equal(s.hasActivity, false);
    assert.deepEqual(s.badges, []);
    assert.equal(s.topBadge, null);
  });

  it("a thrown getAuthorReputation callback degrades honestly instead of crashing the gallery lookup", () => {
    pub("gallery.rep-throws", "author-throws");
    const entry = getGalleryEntry("gallery.rep-throws", null, {
      getAuthorReputation: () => { throw new Error("boom"); },
    });
    assert.equal(entry.ok, true);
    assert.equal(entry.plugin.authorReputationSummary.available, false);
  });

  it("listGallery attaches authorReputationSummary to every entry", () => {
    pub("gallery.rep-list-a", "author-list-1");
    pub("gallery.rep-list-b", "author-list-2");
    const list = listGallery({ search: "rep-list", getAuthorReputation });
    const found = list.plugins.map((p) => p.pluginId).sort();
    assert.deepEqual(found, ["gallery.rep-list-a", "gallery.rep-list-b"]);
    for (const p of list.plugins) {
      assert.ok(p.authorReputationSummary, `${p.pluginId} should carry authorReputationSummary`);
      assert.equal(p.authorReputationSummary.authorId, p.authorId);
    }
  });

  it("listGallery dedupes the reputation lookup per unique author (no N+1 across a prolific publisher's entries)", () => {
    pub("gallery.rep-dedupe-a", "author-prolific");
    pub("gallery.rep-dedupe-b", "author-prolific");
    pub("gallery.rep-dedupe-c", "author-prolific");
    callCount = 0;
    const list = listGallery({ search: "rep-dedupe", getAuthorReputation });
    assert.equal(list.plugins.length, 3);
    assert.equal(callCount, 1, "one author across 3 entries must cost exactly one reputation lookup");
  });

  it("this is a SEPARATE signal from the self-attested trusted/trustDescription fields", () => {
    pub("gallery.rep-vs-trust", "author-vs-trust"); // unsigned publish -> trusted:false
    const entry = getGalleryEntry("gallery.rep-vs-trust", null, { getAuthorReputation });
    assert.equal(entry.plugin.trusted, false);
    assert.equal(typeof entry.plugin.trustDescription, "string");
    assert.ok("authorReputationSummary" in entry.plugin, "reputation summary must exist independent of the trust fields");
    assert.notEqual(entry.plugin.authorReputationSummary, undefined);
  });
});
