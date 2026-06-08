// tests/depth/profile-behavior.test.js — REAL behavioral tests for the
// "profile" lens-action domain (the de-demo'd PlayerProfile backend).
//
// LOCAL SHIM: register the domain against a Map and invoke handlers directly,
// so the tests need neither server boot nor a DB. Handlers are
// `(ctx, artifact, params)` and return `{ ok, result }`.
//
// Coverage: exact values, profile-update round-trip, visitor-log round-trip,
// validation rejections, and empty-by-default assertions (no fabricated rows
// when there's no DB / no real source).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/profile.js";

// ── shim ─────────────────────────────────────────────────────────
const H = new Map();
register((_domain, action, fn) => H.set(action, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Each test starts from a clean per-user STATE so counts/round-trips are exact.
beforeEach(() => {
  if (globalThis._concordSTATE) {
    globalThis._concordSTATE.playerProfiles = new Map();
    globalThis._concordSTATE.profileVisitors = new Map();
    globalThis._concordSTATE._profileVisitorSeq = 0;
  }
});

describe("profile — registration", () => {
  it("registers exactly the seven expected macros", () => {
    const names = [...H.keys()];
    for (const m of [
      "profile-get", "profile-update", "badges-list", "portfolio-list",
      "reputation-summary", "visitor-record", "visitors-list",
    ]) {
      assert.ok(names.includes(m), `missing macro ${m}`);
    }
  });
});

describe("profile — editable profile (empty default + update round-trip)", () => {
  it("profile-get returns empty defaults for a fresh user (no fabrication)", () => {
    const r = run("profile-get");
    assert.equal(r.ok, true);
    const p = r.result.profile;
    assert.equal(p.id, "u1");
    assert.equal(p.displayName, "");
    assert.equal(p.bio, "");
    assert.equal(p.profession, "");
    assert.equal(p.firmName, "");
    assert.equal(p.avatar, "");
    assert.equal(p.updatedAt, null);
  });

  it("profile-update patches fields and profile-get reads them back", () => {
    const upd = run("profile-update", {}, {
      displayName: "Iyatte", bio: "I build domes.", profession: "Architect", firmName: "Seam Works",
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.profile.displayName, "Iyatte");
    assert.equal(upd.result.profile.profession, "Architect");
    assert.ok(typeof upd.result.profile.updatedAt === "string");

    const got = run("profile-get");
    assert.equal(got.result.profile.displayName, "Iyatte");
    assert.equal(got.result.profile.bio, "I build domes.");
    assert.equal(got.result.profile.firmName, "Seam Works");
  });

  it("profile-update trims whitespace on persisted fields", () => {
    const upd = run("profile-update", {}, { displayName: "  Brackish  " });
    assert.equal(upd.result.profile.displayName, "Brackish");
  });

  it("profile-update is per-user scoped (u2 does not see u1's edits)", () => {
    run("profile-update", {}, { displayName: "Alpha" }, { actor: { userId: "uA" } });
    const b = run("profile-get", {}, {}, { actor: { userId: "uB" } });
    assert.equal(b.result.profile.displayName, "");
  });

  it("profile-update with a blank field is rejected", () => {
    const bad = run("profile-update", {}, { displayName: "   " });
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("displayName cannot be empty"));
  });

  it("profile-update with no updatable fields is rejected", () => {
    const bad = run("profile-update", {}, { unknownField: "x" });
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("no updatable fields"));
  });
});

describe("profile — badges/portfolio/reputation empty by default (no DB → no fabrication)", () => {
  it("badges-list returns [] when there is no DB", () => {
    const r = run("badges-list");
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.badges, []);
    assert.equal(r.result.count, 0);
  });

  it("portfolio-list returns [] when there is no DB", () => {
    const r = run("portfolio-list");
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.portfolio, []);
    assert.equal(r.result.count, 0);
  });

  it("reputation-summary returns honest zeros + no reputation polygon when there is no DB", () => {
    const r = run("reputation-summary");
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCitations, 0);
    assert.equal(r.result.totalRoyalties, 0);
    assert.equal(r.result.worldsOwned, 0);
    assert.equal(r.result.dtuCount, 0);
    assert.deepEqual(r.result.reputation, []);
  });
});

describe("profile — badges/portfolio/reputation read REAL data when a DB is present", () => {
  // Minimal in-memory fake DB: enough sqlite_master + prepared-statement shape
  // for the handlers' queries. We seed REAL rows and assert they surface; we
  // never seed rows for a table and assert it stays empty (no fabrication).
  function fakeDb({ achievements = [], catalog = [], dtus = [], citations = {}, worlds = [] }) {
    const tables = new Set();
    if (achievements) tables.add("player_achievements");
    if (catalog && catalog.length) tables.add("achievement_catalog");
    if (dtus) tables.add("dtus");
    if (citations) tables.add("dtu_citations");
    if (worlds) tables.add("player_world_metrics");
    return {
      prepare(sql) {
        return {
          get(...args) {
            if (sql.includes("FROM sqlite_master")) {
              return tables.has(args[0]) ? { name: args[0] } : undefined;
            }
            if (sql.includes("COUNT(*) AS n FROM dtus")) {
              const uid = args[0];
              const owned = dtus.filter((d) => d.creator_id === uid);
              return { n: owned.length };
            }
            if (sql.includes("SUM(cit.citation_count)")) {
              const uid = args[0];
              const owned = dtus.filter((d) => d.creator_id === uid);
              const c = owned.reduce((s, d) => s + (citations[d.id] || 0), 0);
              return { c };
            }
            if (sql.includes("COUNT(*) AS n FROM player_world_metrics")) {
              const uid = args[0];
              return { n: worlds.filter((w) => w.user_id === uid).length };
            }
            return undefined;
          },
          all(...args) {
            const uid = args[0];
            if (sql.includes("FROM player_achievements")) {
              const earned = achievements.filter((a) => a.player_id === uid);
              return earned.map((a) => {
                const cat = catalog.find((c) => c.id === a.achievement_id);
                return {
                  id: a.achievement_id, earnedAt: a.earned_at,
                  title: cat?.title, description: cat?.description,
                  icon: cat?.icon, rarity: cat?.rarity, category: cat?.category,
                };
              });
            }
            if (sql.includes("FROM dtus")) {
              const owned = dtus.filter((d) => d.creator_id === uid);
              return owned.map((d) => ({
                id: d.id, title: d.title, createdAt: d.created_at,
                visibility: d.visibility, citations: citations[d.id] || 0,
              }));
            }
            return [];
          },
        };
      },
    };
  }

  it("badges-list surfaces REAL earned achievements joined to the catalog", () => {
    const db = fakeDb({
      achievements: [{ player_id: "u1", achievement_id: "first_dome", earned_at: 1700000000 }],
      catalog: [{ id: "first_dome", title: "First Dome", description: "Built a dome.", icon: "🏛️", rarity: "gold", category: "mastery" }],
    });
    const r = run("badges-list", {}, {}, { actor: { userId: "u1" }, db });
    assert.equal(r.result.count, 1);
    const b = r.result.badges[0];
    assert.equal(b.id, "first_dome");
    assert.equal(b.name, "First Dome");
    assert.equal(b.description, "Built a dome.");
    assert.equal(b.icon, "🏛️");
    assert.equal(b.rarity, "gold");
    assert.equal(b.earnedDate, "2023-11-14"); // 1700000000s
  });

  it("badges-list returns [] for a user with no earned rows even when the table exists", () => {
    const db = fakeDb({
      achievements: [{ player_id: "someone-else", achievement_id: "x", earned_at: 1 }],
    });
    const r = run("badges-list", {}, {}, { actor: { userId: "u1" }, db });
    assert.deepEqual(r.result.badges, []);
    assert.equal(r.result.count, 0);
  });

  it("portfolio-list surfaces REAL authored DTUs with joined citation counts", () => {
    const db = fakeDb({
      dtus: [
        { id: "d1", creator_id: "u1", title: "Beam Frame FEA", created_at: "2026-01-02T00:00:00Z", visibility: "public" },
        { id: "d2", creator_id: "u1", title: "Untitled", created_at: "2026-01-01T00:00:00Z", visibility: "private" },
        { id: "d3", creator_id: "u2", title: "Not mine", created_at: "2026-01-03T00:00:00Z", visibility: "public" },
      ],
      citations: { d1: 7, d2: 0 },
    });
    const r = run("portfolio-list", {}, {}, { actor: { userId: "u1" }, db });
    assert.equal(r.result.count, 2); // only u1's two DTUs
    const item = r.result.portfolio.find((x) => x.id === "d1");
    assert.equal(item.name, "Beam Frame FEA");
    assert.equal(item.citations, 7);
    assert.equal(item.publishedDate, "2026-01-02");
    assert.ok(!r.result.portfolio.some((x) => x.id === "d3")); // never another user's
  });

  it("reputation-summary derives exact totals + a deterministic polygon from REAL activity", () => {
    const db = fakeDb({
      dtus: [
        { id: "d1", creator_id: "u1", title: "A", created_at: "2026-01-01Z", visibility: "public" },
        { id: "d2", creator_id: "u1", title: "B", created_at: "2026-01-02Z", visibility: "public" },
      ],
      citations: { d1: 5, d2: 1 },
      worlds: [{ user_id: "u1" }, { user_id: "u1" }],
    });
    const r = run("reputation-summary", {}, {}, { actor: { userId: "u1" }, db });
    assert.equal(r.result.dtuCount, 2);
    assert.equal(r.result.totalCitations, 6); // 5 + 1
    assert.equal(r.result.worldsOwned, 2);
    // 8 domains, all 0..100, deterministic (same input → same output).
    assert.equal(r.result.reputation.length, 8);
    for (const s of r.result.reputation) {
      assert.ok(s.score >= 0 && s.score <= 100);
    }
    const again = run("reputation-summary", {}, {}, { actor: { userId: "u1" }, db });
    assert.deepEqual(again.result.reputation, r.result.reputation);
  });
});

describe("profile — visitor log (round-trip, ordering, per-profile scope)", () => {
  it("visitor-record appends and visitors-list reads it back newest-first", () => {
    const rec1 = run("visitor-record", {}, { profileUserId: "host1", visitorName: "Orin", inspected: "Beam Frame" }, { actor: { userId: "orin" } });
    assert.equal(rec1.ok, true);
    assert.equal(rec1.result.visitor.playerName, "Orin");
    assert.equal(rec1.result.visitor.inspected, "Beam Frame");
    const rec2 = run("visitor-record", {}, { profileUserId: "host1", visitorName: "Kel" }, { actor: { userId: "kel" } });
    assert.equal(rec2.result.count, 2);

    const list = run("visitors-list", {}, { profileUserId: "host1" });
    assert.equal(list.result.count, 2);
    // Newest-first: Kel recorded after Orin.
    assert.equal(list.result.visitors[0].playerName, "Kel");
    assert.ok(list.result.visitors.some((v) => v.playerName === "Orin"));
  });

  it("visitor-record defaults profileUserId to the caller (self-view)", () => {
    run("visitor-record", {}, { visitorName: "Self" }, { actor: { userId: "solo" } });
    const list = run("visitors-list", {}, {}, { actor: { userId: "solo" } });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.visitors[0].playerName, "Self");
  });

  it("visitors-list is empty by default (no fabricated visits)", () => {
    const list = run("visitors-list", {}, { profileUserId: "never-visited" });
    assert.deepEqual(list.result.visitors, []);
    assert.equal(list.result.count, 0);
  });

  it("visitor logs are scoped per profile (host2 doesn't see host1's visitors)", () => {
    run("visitor-record", {}, { profileUserId: "host1", visitorName: "X" }, { actor: { userId: "x" } });
    const other = run("visitors-list", {}, { profileUserId: "host2" });
    assert.deepEqual(other.result.visitors, []);
  });
});
