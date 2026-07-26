// server/tests/profile-peer-view.test.js
//
// V1.2 Wave A ("Society & Presence"), capability 4 — "reputation + citation
// graph". Contract tests for the `targetUserId` extension to
// profile.profile-get / profile.badges-list / profile.reputation-summary /
// profile.portfolio-list (server/domains/profile.js).
//
// Uses a REAL in-memory better-sqlite3 DB with the real migrations applied
// (001 dtus/users, 087 dtus.creator_id, 010 dtu_citations, 047
// player_achievements, 216 achievement_catalog) — not a hand-rolled fake —
// so the visibility-filtering SQL added for peer view is genuinely
// exercised, matching the established pattern in
// github-code-lens-macros.test.js (real db + real migrations, a dedicated
// cross-user-isolation suite, macro-level param tests).
//
// Coverage:
//   - self view is BYTE-FOR-BYTE backward compatible (no targetUserId param
//     -> identical shape/values to the pre-existing behavior);
//   - peer view (targetUserId set) surfaces REAL public data for another
//     real user, not the caller's own;
//   - peer view redacts: profile-get strips to an explicit allow-list
//     (excludes updatedAt), portfolio-list + reputation-summary's dtuCount
//     exclude private/internal DTUs a stranger could never otherwise browse.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrateCore } from "../migrations/001_core_tables.js";
import { up as migrateCreatorId } from "../migrations/087_dtus_type_creator_data.js";
import { up as migrateDtuCitations } from "../migrations/010_learning_verification.js";
import { up as migrateAchievements } from "../migrations/047_game_mode_tables.js";
import { up as migrateAchievementCatalog } from "../migrations/216_achievement_catalog.js";

import register from "../domains/profile.js";

// ── shim ─────────────────────────────────────────────────────────────────
const H = new Map();
register((_domain, action, fn) => H.set(action, fn));
const run = (action, ctxUserId, params = {}) =>
  H.get(action)({ actor: { userId: ctxUserId }, db: DB }, { data: {} }, params);

let DB;

function freshDb() {
  const db = new Database(":memory:");
  migrateCore(db);
  migrateCreatorId(db);
  migrateDtuCitations(db);
  migrateAchievements(db);
  migrateAchievementCatalog(db);
  return db;
}

function ensureUser(db, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(userId, userId, `${userId}@example.test`);
}

function insertDtu(db, { id, creatorId, title, visibility = "public", createdAt = "2026-01-01T00:00:00Z" }) {
  // dtus.owner_user_id carries a real FK to users(id) — this DB has
  // foreign_keys=ON by default (better-sqlite3), so seed a minimal real
  // user row first rather than relaxing the constraint.
  ensureUser(db, creatorId);
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', '[]', ?, 'regular', ?, ?)
  `).run(id, creatorId, creatorId, title, visibility, createdAt, createdAt);
}

function insertCitations(db, dtuId, count) {
  db.prepare(`
    INSERT INTO dtu_citations (dtu_id, citation_count, first_cited, last_cited)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `).run(dtuId, count);
}

function insertAchievement(db, { playerId, achievementId, earnedAt = 1700000000, title = null, icon = null }) {
  db.prepare(`INSERT INTO player_achievements (player_id, achievement_id, earned_at) VALUES (?, ?, ?)`)
    .run(playerId, achievementId, earnedAt);
  if (title) {
    db.prepare(`INSERT INTO achievement_catalog (id, title, icon) VALUES (?, ?, ?)`)
      .run(achievementId, title, icon || "🏆");
  }
}

beforeEach(() => {
  DB = freshDb();
  if (globalThis._concordSTATE) {
    globalThis._concordSTATE.playerProfiles = new Map();
    globalThis._concordSTATE.profileVisitors = new Map();
    globalThis._concordSTATE._profileVisitorSeq = 0;
  }
});

// ── Backward compatibility: self view is unchanged ─────────────────────────
describe("profile targetUserId — self view is fully backward compatible", () => {
  it("profile-get with no targetUserId returns the full editable profile + isSelf:true", () => {
    run("profile-update", "u1", { displayName: "Iyatte", bio: "I build domes." });
    const r = run("profile-get", "u1");
    assert.equal(r.ok, true);
    assert.equal(r.result.isSelf, true);
    assert.equal(r.result.profile.displayName, "Iyatte");
    assert.equal(r.result.profile.bio, "I build domes.");
    assert.ok(typeof r.result.profile.updatedAt === "string"); // self sees updatedAt
  });

  it("profile-get with targetUserId equal to the caller behaves identically to omitting it", () => {
    run("profile-update", "u1", { displayName: "Iyatte" });
    const omitted = run("profile-get", "u1");
    const explicit = run("profile-get", "u1", { targetUserId: "u1" });
    assert.deepEqual(explicit.result, omitted.result);
  });

  it("badges-list / reputation-summary / portfolio-list self view unaffected by the new param", () => {
    insertDtu(DB, { id: "d1", creatorId: "u1", title: "Beam Frame", visibility: "private" });
    insertCitations(DB, "d1", 4);
    insertAchievement(DB, { playerId: "u1", achievementId: "first_dome", title: "First Dome" });

    const badges = run("badges-list", "u1");
    assert.equal(badges.result.count, 1);
    assert.equal(badges.result.isSelf, true);

    const rep = run("reputation-summary", "u1");
    assert.equal(rep.result.dtuCount, 1); // self sees the PRIVATE dtu too
    assert.equal(rep.result.totalCitations, 4);
    assert.equal(rep.result.isSelf, true);

    const port = run("portfolio-list", "u1");
    assert.equal(port.result.count, 1); // self sees the PRIVATE dtu too
    assert.equal(port.result.isSelf, true);
  });
});

// ── Peer view: real public data for ANOTHER real user ──────────────────────
describe("profile targetUserId — peer view surfaces REAL data for another real user", () => {
  it("reputation-summary(targetUserId=u2) returns u2's real totals, not the caller's own", () => {
    insertDtu(DB, { id: "u1-dtu", creatorId: "u1", title: "Caller's own work" });
    insertDtu(DB, { id: "u2-dtu", creatorId: "u2", title: "Beam Frame FEA" });
    insertCitations(DB, "u2-dtu", 9);

    // Caller u1 looks at u2's reputation.
    const r = run("reputation-summary", "u1", { targetUserId: "u2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.isSelf, false);
    assert.equal(r.result.dtuCount, 1);
    assert.equal(r.result.totalCitations, 9);
    assert.equal(r.result.reputation.length, 8);
  });

  it("badges-list(targetUserId=u2) returns u2's real earned badges", () => {
    insertAchievement(DB, { playerId: "u2", achievementId: "master_welder", title: "Master Welder", icon: "🔧" });
    const r = run("badges-list", "u1", { targetUserId: "u2" });
    assert.equal(r.result.isSelf, false);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.badges[0].name, "Master Welder");
  });

  it("portfolio-list(targetUserId=u2) returns u2's real PUBLIC dtus", () => {
    insertDtu(DB, { id: "pub1", creatorId: "u2", title: "Public Dome", visibility: "public" });
    insertCitations(DB, "pub1", 2);
    const r = run("portfolio-list", "u1", { targetUserId: "u2" });
    assert.equal(r.result.isSelf, false);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.portfolio[0].name, "Public Dome");
    assert.equal(r.result.portfolio[0].citations, 2);
  });
});

// ── Security: peer view redacts private fields — the discipline-matching
// stranger-can't-see-private-data proof ────────────────────────────────────
describe("profile targetUserId — a stranger sees public fields but NEVER private ones", () => {
  it("profile-get(targetUserId) exposes ONLY the allow-listed fields — never updatedAt", () => {
    run("profile-update", "u2", { displayName: "Kel", bio: "Ledger keeper.", profession: "Auditor" });
    const peer = run("profile-get", "u1", { targetUserId: "u2" });
    assert.equal(peer.result.isSelf, false);
    assert.equal(peer.result.profile.displayName, "Kel");
    assert.equal(peer.result.profile.bio, "Ledger keeper.");
    // The exact, exhaustive key set — nothing beyond the allow-list leaks,
    // even though the underlying stored object also carries `updatedAt`.
    assert.deepEqual(
      Object.keys(peer.result.profile).sort(),
      ["avatar", "bio", "displayName", "firmName", "id", "profession"].sort(),
    );
    assert.ok(!("updatedAt" in peer.result.profile), "updatedAt must never leak to a peer viewer");

    // Confirm the self view of the SAME user genuinely does carry it (proves
    // the field exists and is being deliberately stripped, not just absent).
    const self = run("profile-get", "u2");
    assert.ok("updatedAt" in self.result.profile);
    assert.ok(typeof self.result.profile.updatedAt === "string");
  });

  it("portfolio-list(targetUserId) never surfaces the target's PRIVATE/internal dtus", () => {
    insertDtu(DB, { id: "priv1", creatorId: "u2", title: "Secret Ledger", visibility: "private" });
    insertDtu(DB, { id: "int1", creatorId: "u2", title: "Internal Draft", visibility: "internal" });
    insertDtu(DB, { id: "pub1", creatorId: "u2", title: "Public Dome", visibility: "public" });

    const peer = run("portfolio-list", "u1", { targetUserId: "u2" });
    assert.equal(peer.result.count, 1);
    assert.equal(peer.result.portfolio[0].id, "pub1");
    assert.ok(!peer.result.portfolio.some((p) => p.id === "priv1"), "private DTU must never leak to a stranger");
    assert.ok(!peer.result.portfolio.some((p) => p.id === "int1"), "internal DTU must never leak to a stranger");

    // The OWNER, viewing their own portfolio, sees all three.
    const self = run("portfolio-list", "u2");
    assert.equal(self.result.count, 3);
  });

  it("reputation-summary(targetUserId) dtuCount only counts what a stranger could actually browse", () => {
    insertDtu(DB, { id: "priv1", creatorId: "u2", title: "Secret Ledger", visibility: "private" });
    insertDtu(DB, { id: "pub1", creatorId: "u2", title: "Public Dome", visibility: "public" });
    insertCitations(DB, "priv1", 100); // large private-only citation count must not leak either
    insertCitations(DB, "pub1", 3);

    const peer = run("reputation-summary", "u1", { targetUserId: "u2" });
    assert.equal(peer.result.dtuCount, 1); // only the public one
    assert.equal(peer.result.totalCitations, 3); // never the private DTU's citations

    const self = run("reputation-summary", "u2");
    assert.equal(self.result.dtuCount, 2);
    assert.equal(self.result.totalCitations, 103);
  });

  it("empty-DB honest-zero path also carries isSelf for peer view", () => {
    const emptyDb = new Database(":memory:"); // no migrations at all
    const r = H.get("reputation-summary")(
      { actor: { userId: "u1" }, db: emptyDb },
      { data: {} },
      { targetUserId: "ghost-user" },
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.isSelf, false);
    assert.equal(r.result.dtuCount, 0);
    assert.deepEqual(r.result.reputation, []);
  });
});
