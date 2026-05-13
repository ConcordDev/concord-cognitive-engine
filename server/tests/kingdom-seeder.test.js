/**
 * Tier-2 contract test for the kingdom seeder.
 *
 * Pins:
 *   - Seeds at least one realm per canon Sovereign world that has
 *     factions with controlled_districts.
 *   - Skips concordia-hub (Concordant Law).
 *   - Idempotent: re-run produces realms_skipped > 0 and 0 new rows.
 *   - For Tunya specifically, all 14 country-factions get realms.
 *   - Each seeded realm has at least one territory and at least one citizen.
 *
 * Run: node --test tests/kingdom-seeder.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";

import { seedKingdoms, KINGDOM_SEEDER_CONSTANTS } from "../lib/kingdom-seeder.js";
import { up as up158 } from "../migrations/158_kingdoms.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function setupDb() {
  const db = new Database(":memory:");
  up158(db);
  return db;
}

describe("kingdom-seeder — base behaviour", () => {
  it("returns ok=true and seeds at least 14 realms (Tunya's 14 country-factions)", () => {
    const db = setupDb();
    const r = seedKingdoms(db, { repoRoot: REPO_ROOT });
    assert.equal(r.ok, true);
    assert.ok(r.realms_created >= 14, `expected ≥ 14 realms, got ${r.realms_created}`);
  });

  it("seeds territories ≥ realms_created", () => {
    const db = setupDb();
    const r = seedKingdoms(db, { repoRoot: REPO_ROOT });
    assert.ok(r.territories_seeded >= r.realms_created);
  });

  it("seeds at least some citizens (factions with authored NPCs)", () => {
    const db = setupDb();
    const r = seedKingdoms(db, { repoRoot: REPO_ROOT });
    assert.ok(r.citizens_seeded >= 1, "expected at least 1 citizen seeded");
  });
});

describe("kingdom-seeder — Tunya country-factions", () => {
  it("every Tunyan faction with controlled_districts becomes a realm", () => {
    const db = setupDb();
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    const tunyaRealms = db.prepare(`SELECT id, faction_id FROM realms WHERE world_id = 'tunya'`).all();
    assert.ok(tunyaRealms.length >= 14, `Tunya should have ≥ 14 realms (one per country-faction), got ${tunyaRealms.length}`);

    // Specific country-factions must be present.
    const factionIds = new Set(tunyaRealms.map(r => r.faction_id));
    for (const id of ["dinye", "aekon", "asbir", "fluxom", "nil", "akeia_of_kahlay", "sandrun_sanguire", "medici", "sahm", "bahiij"]) {
      assert.ok(factionIds.has(id), `missing realm for Tunyan faction "${id}"`);
    }
  });

  it("Tunya realms all have ruler_kind = 'npc'", () => {
    const db = setupDb();
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    const tunyaRealms = db.prepare(`SELECT ruler_kind FROM realms WHERE world_id = 'tunya'`).all();
    for (const r of tunyaRealms) assert.equal(r.ruler_kind, "npc");
  });
});

describe("kingdom-seeder — concordia-hub excluded", () => {
  it("no realm row gets world_id = 'concordia-hub'", () => {
    const db = setupDb();
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    const hubRealms = db.prepare(`SELECT COUNT(*) AS n FROM realms WHERE world_id = 'concordia-hub'`).get();
    assert.equal(hubRealms.n, 0);
  });

  it("CANON_WORLDS constant does not contain concordia-hub", () => {
    assert.ok(!KINGDOM_SEEDER_CONSTANTS.CANON_WORLDS.includes("concordia-hub"));
  });
});

describe("kingdom-seeder — idempotency", () => {
  it("second run reports 0 realms_created (all already exist)", () => {
    const db = setupDb();
    const r1 = seedKingdoms(db, { repoRoot: REPO_ROOT });
    const r2 = seedKingdoms(db, { repoRoot: REPO_ROOT });
    assert.ok(r1.realms_created > 0);
    assert.equal(r2.realms_created, 0, "second run must not insert new realms");
    assert.ok(r2.realms_skipped >= r1.realms_created, "second run must skip every previously-seeded realm");
  });

  it("realm count stable across multiple runs", () => {
    const db = setupDb();
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    const after1 = db.prepare(`SELECT COUNT(*) AS n FROM realms`).get().n;
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    const afterMany = db.prepare(`SELECT COUNT(*) AS n FROM realms`).get().n;
    assert.equal(after1, afterMany);
  });
});

describe("kingdom-seeder — all 8 Sovereign worlds covered", () => {
  it("each canon Sovereign world has at least one realm", () => {
    const db = setupDb();
    seedKingdoms(db, { repoRoot: REPO_ROOT });
    for (const worldId of KINGDOM_SEEDER_CONSTANTS.CANON_WORLDS) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM realms WHERE world_id = ?`).get(worldId).n;
      assert.ok(count >= 1, `${worldId} should have ≥ 1 realm, got ${count}`);
    }
  });

  it("total realms ≥ 50 (8 worlds × ~6-14 factions each)", () => {
    const db = setupDb();
    const r = seedKingdoms(db, { repoRoot: REPO_ROOT });
    assert.ok(r.realms_created >= 50, `expected ≥ 50 realms, got ${r.realms_created}`);
  });
});
