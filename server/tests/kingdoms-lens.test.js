/**
 * Kingdoms LENS — Phase 2 non-score gate (REST-route lens).
 *
 * The kingdoms lens is hybrid:
 *   - The PAGE drives the REST surface (`/api/kingdoms*` → routes/kingdoms.js
 *     → lib/kingdom.js): found realm → decree → list → contest → residents.
 *   - The CK3-shape CHILDREN (DynastyRealmManager / RealmActionPanel) drive
 *     the `kingdoms.*` MACRO surface (domains/kingdoms.js), whose REST `my_realm`
 *     side reads the `realms` table (lib/kingdoms.js, plural).
 *
 * This suite is lightweight + hermetic: it exercises the backing LIB functions
 * directly against a migrated in-memory better-sqlite3, asserting ACTUAL
 * computed values, multi-step round-trips, per-user/per-realm isolation, and
 * — load-bearing — the fail-CLOSED numeric guard on the realm-treasury write
 * (`adjustTreasury`) that protects the in-game realm economy from a poisoned
 * (Infinity / NaN / 1e308 / env-derived) delta.
 *
 * Run: node --test server/tests/kingdoms-lens.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up105 } from "../migrations/105_kingdoms.js";
import { up as up158 } from "../migrations/158_kingdoms.js";

import {
  foundKingdom,
  listKingdoms,
  getKingdom,
  enactDecree,
  listDecrees,
  contestKingdom,
  contributeContestStrength,
  resolveContest,
  joinKingdom,
  listResidents,
  pointInKingdom,
  DECREE_KINDS,
} from "../lib/kingdom.js";

import { adjustTreasury, getKingdom as getRealm } from "../lib/kingdoms.js";

/* ── Helpers ──────────────────────────────────────────────────────── */

function restDb() {
  // The REST page surface (routes/kingdoms.js) lives on the mig-105 schema.
  const db = new Database(":memory:");
  // Minimal dtus table for coherence-check.validateDecree probing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, owner_id TEXT, owner_type TEXT, type TEXT,
      tags_json TEXT, skill_level REAL DEFAULT 0
    )
  `);
  up105(db);
  return db;
}

function realmsDb() {
  // The macro `my_realm` + treasury surface lives on the mig-158 `realms` schema.
  const db = new Database(":memory:");
  up158(db);
  return db;
}

const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]];

/* ── 1. REST round-trip: found → list → detail → decree → residents ── */

describe("kingdoms lens — REST round-trip (page surface)", () => {
  it("founds a realm, lists it, and reads detail with residents", () => {
    const db = restDb();
    const r = foundKingdom(db, { rulerId: "user-A", worldId: "fantasy-realm", regionPolygon: SQUARE, name: "Aldenholt" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.kingdomId);

    const list = listKingdoms(db, { worldId: "fantasy-realm" });
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Aldenholt");
    assert.deepEqual(list[0].region_polygon, SQUARE, "region_polygon hydrated from JSON column");

    const k = getKingdom(db, r.kingdomId);
    assert.equal(k.ruler_user_id, "user-A");

    // Founder is auto-registered as ruler resident.
    const residents = listResidents(db, r.kingdomId);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].role, "ruler");
    assert.equal(residents[0].user_id, "user-A");
  });

  it("locates a realm at a point inside its polygon, null outside", () => {
    const db = restDb();
    const r = foundKingdom(db, { rulerId: "u", worldId: "w", regionPolygon: SQUARE, name: "K" });
    const inside = pointInKingdom(db, "w", 50, 50);
    assert.equal(inside?.id, r.kingdomId);
    assert.equal(pointInKingdom(db, "w", 500, 500), null);
  });

  it("rejects malformed polygon and overlapping realm (fail-closed founding)", () => {
    const db = restDb();
    assert.equal(foundKingdom(db, { rulerId: "u", regionPolygon: [[0, 0]], name: "Bad" }).ok, false);
    foundKingdom(db, { rulerId: "u", worldId: "w", regionPolygon: SQUARE, name: "First" });
    const overlap = foundKingdom(db, { rulerId: "u2", worldId: "w", regionPolygon: SQUARE, name: "Second" });
    assert.equal(overlap.ok, false);
    assert.equal(overlap.error, "overlaps_existing_kingdom");
  });
});

/* ── 2. Decree alignment math (enforced / tension / failed) ─────────── */

describe("kingdoms lens — decree alignment branches", () => {
  it("aligned decree enforces; misaligned fails; round-trips into listDecrees", async () => {
    const db = restDb();
    // coherence-check#validateDecree IS wired (the dtus table is present), so
    // these assert the REAL computed alignment, not the genre fallback.
    // tax_levied in a fantasy world → 0.7 → enforced.
    const k = foundKingdom(db, { rulerId: "ruler", worldId: "fantasy-x", regionPolygon: SQUARE, name: "Tariffland" });
    const aligned = await enactDecree(db, k.kingdomId, "tax_levied", {}, { state: null });
    assert.equal(aligned.ok, true);
    assert.equal(aligned.activationState, "enforced", `alignment ${aligned.alignmentScore}`);
    assert.ok(aligned.alignmentScore >= 0.6, `expected enforced score, got ${aligned.alignmentScore}`);

    // firearms_prohibited in a cyberpunk world is genre-hostile → 0.2 → failed.
    const cyberK = foundKingdom(db, { rulerId: "r2", worldId: "cyber-neon", regionPolygon: SQUARE, name: "Neon" });
    const mis = await enactDecree(db, cyberK.kingdomId, "firearms_prohibited", {}, { state: null });
    assert.equal(mis.ok, true);
    assert.equal(mis.activationState, "failed", `alignment ${mis.alignmentScore}`);
    assert.ok(mis.alignmentScore < 0.3, `expected failed score, got ${mis.alignmentScore}`);
    // A failed decree records but is not activated (no activated_at/expires_at).
    const failedRow = listDecrees(db, cyberK.kingdomId, { activeOnly: false })[0];
    assert.equal(failedRow.activation_state, "failed");
    assert.equal(failedRow.expires_at, null);

    // activeOnly filter excludes the failed decree but includes the enforced one.
    const active = listDecrees(db, k.kingdomId, { activeOnly: true });
    assert.equal(active.length, 1);
    assert.equal(active[0].decree_kind, "tax_levied");
    assert.equal(active[0].activation_state, "enforced");
    assert.equal(listDecrees(db, cyberK.kingdomId, { activeOnly: true }).length, 0);
  });

  it("rejects an unknown decree kind", async () => {
    const db = restDb();
    const k = foundKingdom(db, { rulerId: "r", worldId: "w", regionPolygon: SQUARE, name: "K" });
    const r = await enactDecree(db, k.kingdomId, "not_a_real_decree", {}, { state: null });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_decree_kind");
  });

  it("DECREE_KINDS catalog is the source the /_meta route returns", () => {
    assert.ok(DECREE_KINDS.tax_levied);
    assert.equal(DECREE_KINDS.tax_levied.refusalKind, "tax_active");
  });
});

/* ── 3. Contest: overthrow vs repelled + strength math ──────────────── */

describe("kingdoms lens — contest resolution", () => {
  it("overthrows the ruler when contest strength exceeds claim strength", () => {
    const db = restDb();
    const k = foundKingdom(db, { rulerId: "old-king", worldId: "w", regionPolygon: SQUARE, name: "K" });
    // Default claim_strength is small; contest seeds 10 then we contribute past it.
    const c = contestKingdom(db, k.kingdomId, "usurper", "siege");
    assert.equal(c.ok, true);
    // Drive contest strength well above the realm's claim_strength.
    for (let i = 0; i < 5; i++) contributeContestStrength(db, c.contestId, 50);
    const res = resolveContest(db, c.contestId);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "overthrew");

    const after = getKingdom(db, k.kingdomId);
    assert.equal(after.ruler_user_id, "usurper", "ruler transferred on overthrow");
    // Usurper is now ruler in residents; old king demoted to noble.
    const residents = listResidents(db, k.kingdomId);
    const usurper = residents.find((r) => r.user_id === "usurper");
    assert.equal(usurper?.role, "ruler");
  });

  it("repels a weak contest and bumps claim strength", () => {
    const db = restDb();
    const k = foundKingdom(db, { rulerId: "king", worldId: "w2", regionPolygon: SQUARE, name: "Hold" });
    const before = getKingdom(db, k.kingdomId).claim_strength;
    const c = contestKingdom(db, k.kingdomId, "weakling", "siege");
    // No extra contributions; seed strength (10) should not exceed default claim.
    const res = resolveContest(db, c.contestId);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "repelled");
    const after = getKingdom(db, k.kingdomId).claim_strength;
    assert.ok(after >= before, "repelled realm keeps or grows claim strength");
    assert.equal(getKingdom(db, k.kingdomId).ruler_user_id, "king", "ruler unchanged on repel");
  });
});

/* ── 4. Resident registry: join + per-realm isolation ───────────────── */

describe("kingdoms lens — resident registry isolation", () => {
  it("joins users into the right realm only (per-realm isolation)", () => {
    const db = restDb();
    const k1 = foundKingdom(db, { rulerId: "ruler1", worldId: "wa", regionPolygon: SQUARE, name: "Alpha" });
    const k2 = foundKingdom(db, { rulerId: "ruler2", worldId: "wb", regionPolygon: SQUARE, name: "Beta" });
    joinKingdom(db, k1.kingdomId, "citizenX", "citizen");
    joinKingdom(db, k2.kingdomId, "citizenY", "noble");

    const r1 = listResidents(db, k1.kingdomId).map((r) => r.user_id);
    const r2 = listResidents(db, k2.kingdomId).map((r) => r.user_id);
    assert.ok(r1.includes("citizenX"));
    assert.ok(!r1.includes("citizenY"), "Beta's citizen must not appear in Alpha");
    assert.ok(r2.includes("citizenY"));
    assert.ok(!r2.includes("citizenX"));
  });

  it("join is idempotent on (kingdom_id, user_id) — upserts role", () => {
    const db = restDb();
    const k = foundKingdom(db, { rulerId: "r", worldId: "w", regionPolygon: SQUARE, name: "K" });
    joinKingdom(db, k.kingdomId, "u", "citizen");
    joinKingdom(db, k.kingdomId, "u", "guard");
    const residents = listResidents(db, k.kingdomId).filter((r) => r.user_id === "u");
    assert.equal(residents.length, 1, "no duplicate resident rows");
    assert.equal(residents[0].role, "guard", "role upserted");
  });
});

/* ── 5. Realm treasury — fail-CLOSED numeric guard (money path) ──────── */

describe("kingdoms lens — realm treasury fail-closed guard", () => {
  function seedRealm(db) {
    db.prepare(`
      INSERT INTO realms (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
      VALUES ('rlm1', 'Crownland', 'w', 'fac1', 'player', 'userZ', 60, 1000, 0.10)
    `).run();
    return "rlm1";
  }

  it("applies a finite delta and floors treasury at 0", () => {
    const db = realmsDb();
    const id = seedRealm(db);
    assert.equal(adjustTreasury(db, id, 250).ok, true);
    assert.equal(getRealm(db, id).treasury, 1250);
    // Large negative drain floors at 0, never goes below.
    assert.equal(adjustTreasury(db, id, -99999).ok, true);
    assert.equal(getRealm(db, id).treasury, 0);
  });

  it("REJECTS Infinity / NaN / 1e308 deltas and leaves treasury untouched", () => {
    const db = realmsDb();
    const id = seedRealm(db);
    const before = getRealm(db, id).treasury;
    for (const poison of [Infinity, -Infinity, NaN, 1e308, "1e309", "not-a-number"]) {
      const r = adjustTreasury(db, id, poison);
      assert.equal(r.ok, false, `poison ${String(poison)} must be rejected`);
      assert.equal(r.reason, "invalid_delta");
      assert.equal(getRealm(db, id).treasury, before, `treasury must be unchanged after poison ${String(poison)}`);
    }
  });

  it("rejects an absurd-but-finite magnitude above the 1e9 cap", () => {
    const db = realmsDb();
    const id = seedRealm(db);
    const before = getRealm(db, id).treasury;
    const r = adjustTreasury(db, id, 5e9);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_delta");
    assert.equal(getRealm(db, id).treasury, before);
  });

  it("treasury writes are per-realm isolated", () => {
    const db = realmsDb();
    const a = seedRealm(db);
    db.prepare(`
      INSERT INTO realms (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
      VALUES ('rlm2', 'Otherland', 'w', 'fac2', 'player', 'userQ', 60, 500, 0.10)
    `).run();
    adjustTreasury(db, a, 100);
    assert.equal(getRealm(db, a).treasury, 1100);
    assert.equal(getRealm(db, "rlm2").treasury, 500, "second realm untouched");
  });
});
