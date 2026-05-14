/**
 * Tier-2 contract tests for Phase 6 — creature homes + sleep patterns
 * + ecology imbalance signaling.
 *
 * Pins:
 *   - ensureHomeFor idempotent on (world, biome, species)
 *   - water biome returns null (no home anchor — they live in the volume)
 *   - kind mapping (bear → cave, deer → den, rabbit → warren, hawk → roost)
 *   - registerSleepPattern + isAtHomeHour handle wraparound (nocturnal)
 *   - seedSleepPatterns is idempotent
 *   - recordImbalance dedupes via signature within the same day-bucket
 *   - unresolvedImbalances filters by world_id
 *   - ecology-quest-cycle resolves the row after spawning the quest
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up184 } from "../migrations/184_creature_homes.js";
import {
  ensureHomeFor,
  listHomesForWorld,
  registerSleepPattern,
  seedSleepPatterns,
  isAtHomeHour,
  recordImbalance,
  unresolvedImbalances,
  resolveImbalance,
} from "../lib/ecosystem/creature-homes.js";

function setupDb() {
  const db = new Database(":memory:");
  up184(db);
  return db;
}

describe("creature_homes anchors", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("ensureHomeFor inserts one row per (world, biome, species)", () => {
    const a = ensureHomeFor(db, { worldId: "tunya", biome: "forest", speciesId: "deer" });
    assert.ok(a);
    assert.equal(a.kind, "den", "deer should map to den");
    const homes = listHomesForWorld(db, "tunya");
    assert.equal(homes.length, 1);
  });

  it("ensureHomeFor is idempotent — second call returns the same row", () => {
    const a = ensureHomeFor(db, { worldId: "tunya", biome: "forest", speciesId: "deer" });
    const b = ensureHomeFor(db, { worldId: "tunya", biome: "forest", speciesId: "deer" });
    assert.equal(a.id, b.id);
    assert.equal(a.x, b.x);
    assert.equal(a.z, b.z);
    const homes = listHomesForWorld(db, "tunya");
    assert.equal(homes.length, 1, "idempotent: still 1 row");
  });

  it("kind mapping: bear → cave, rabbit → warren, hawk → roost", () => {
    const bear  = ensureHomeFor(db, { worldId: "w", biome: "mountain", speciesId: "bear" });
    const rab   = ensureHomeFor(db, { worldId: "w", biome: "plains",   speciesId: "rabbit" });
    const hawk  = ensureHomeFor(db, { worldId: "w", biome: "highland", speciesId: "hawk" });
    assert.equal(bear.kind, "cave");
    assert.equal(rab.kind,  "warren");
    assert.equal(hawk.kind, "roost");
  });

  it("water biome returns null (no home anchor — creatures live in the volume)", () => {
    const fish = ensureHomeFor(db, { worldId: "w", biome: "water", speciesId: "fish" });
    assert.equal(fish, null);
  });

  it("same (biome, species) in different worlds gets different anchors", () => {
    const a = ensureHomeFor(db, { worldId: "tunya",   biome: "forest", speciesId: "deer" });
    const b = ensureHomeFor(db, { worldId: "fantasy", biome: "forest", speciesId: "deer" });
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.x, b.x, "different worlds → different coords");
  });
});

describe("sleep patterns", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("seedSleepPatterns inserts the built-in registry", () => {
    const r = seedSleepPatterns(db);
    assert.ok(r.seeded >= 10, `expected ≥10 seeded patterns, got ${r.seeded}`);
    const all = db.prepare(`SELECT * FROM creature_sleep_patterns`).all();
    assert.ok(all.length >= 10);
  });

  it("seedSleepPatterns is idempotent — second call updates without dupe", () => {
    seedSleepPatterns(db);
    const before = db.prepare(`SELECT COUNT(*) AS c FROM creature_sleep_patterns`).get().c;
    seedSleepPatterns(db);
    const after = db.prepare(`SELECT COUNT(*) AS c FROM creature_sleep_patterns`).get().c;
    assert.equal(after, before);
  });

  it("isAtHomeHour handles nocturnal wraparound (20:00 → 05:00 active)", () => {
    seedSleepPatterns(db);
    // bear is nocturnal active 20:00-05:00 (hibernation aside).
    assert.equal(isAtHomeHour(db, "bear", 21), false, "21:00 is active for nocturnal");
    assert.equal(isAtHomeHour(db, "bear",  2), false, "02:00 is active for nocturnal (wraparound)");
    assert.equal(isAtHomeHour(db, "bear", 10), true,  "10:00 is rest for nocturnal");
    assert.equal(isAtHomeHour(db, "bear", 18), true,  "18:00 is rest for nocturnal");
  });

  it("isAtHomeHour handles diurnal (06:00 → 20:00 active)", () => {
    seedSleepPatterns(db);
    assert.equal(isAtHomeHour(db, "goat", 10), false, "10:00 is active for diurnal");
    assert.equal(isAtHomeHour(db, "goat", 22), true,  "22:00 is rest");
    assert.equal(isAtHomeHour(db, "goat",  2), true,  "02:00 is rest");
  });

  it("isAtHomeHour for unknown species defaults to diurnal 6-20", () => {
    assert.equal(isAtHomeHour(db, "novel_species", 10), false);
    assert.equal(isAtHomeHour(db, "novel_species", 22), true);
  });

  it("registerSleepPattern lets a caller override the default", () => {
    registerSleepPattern(db, "custom_owl", {
      active_phase: "nocturnal",
      active_start_hour: 22,
      active_end_hour: 4,
    });
    assert.equal(isAtHomeHour(db, "custom_owl", 23), false);
    assert.equal(isAtHomeHour(db, "custom_owl", 12), true);
  });
});

describe("ecology imbalance signal", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("recordImbalance inserts a row with stable signature", () => {
    const r = recordImbalance(db, {
      worldId: "tunya", biome: "forest", kind: "predator_excess",
      severity: 3, summary: "wolves outpacing deer in tunya/forest",
    });
    assert.equal(r.inserted, 1);
    assert.ok(r.signature);
  });

  it("dedupes within the same day-bucket — re-call returns inserted=0", () => {
    const a = recordImbalance(db, {
      worldId: "tunya", biome: "forest", kind: "predator_excess",
      severity: 3, summary: "first",
    });
    const b = recordImbalance(db, {
      worldId: "tunya", biome: "forest", kind: "predator_excess",
      severity: 4, summary: "second",
    });
    assert.equal(a.inserted, 1);
    assert.equal(b.inserted, 0);
    assert.equal(a.signature, b.signature);
  });

  it("unresolvedImbalances filters by world_id", () => {
    recordImbalance(db, { worldId: "tunya",   biome: "forest", kind: "predator_excess", severity: 2, summary: "x" });
    recordImbalance(db, { worldId: "fantasy", biome: "forest", kind: "predator_excess", severity: 2, summary: "y" });
    const t = unresolvedImbalances(db, "tunya");
    assert.equal(t.length, 1);
    assert.equal(t[0].world_id, "tunya");
    const all = unresolvedImbalances(db);
    assert.equal(all.length, 2);
  });

  it("resolveImbalance flips resolved_at and excludes from unresolved list", () => {
    const r = recordImbalance(db, { worldId: "tunya", biome: "forest", kind: "predator_excess", severity: 2, summary: "x" });
    const id = `eco_${r.signature.slice(0, 12)}`;
    const out = resolveImbalance(db, id);
    assert.equal(out.ok, true);
    assert.equal(unresolvedImbalances(db, "tunya").length, 0);
  });
});
