// Phase BD2 — difficulty tier tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getModifier, applyDifficulty, tierUnlockedFor, recordClear,
  TIER_ORDER, PREREQ,
} from "../lib/difficulty.js";
import { up as upDifficulty } from "../migrations/241_difficulty_tiers.js";

function freshDb() { const db = new Database(":memory:"); upDifficulty(db); return db; }

describe("Phase BD2 — difficulty modifiers", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("seeds 4 tiers with correct multipliers", () => {
    const finder = getModifier(db, "finder");
    const normal = getModifier(db, "normal");
    const heroic = getModifier(db, "heroic");
    const mythic = getModifier(db, "mythic");
    assert.equal(finder.damage_mult, 0.5);
    assert.equal(normal.damage_mult, 1.0);
    assert.equal(heroic.damage_mult, 1.5);
    assert.equal(mythic.damage_mult, 2.5);
    assert.equal(mythic.loot_mult, 2.5);
  });

  it("getModifier returns null for invalid tier", () => {
    assert.equal(getModifier(db, "godly"), null);
  });

  it("applyDifficulty scales damage/health/loot purely (no mutation)", () => {
    const enc = { id: "boss-a", damage: 100, health: 1000, loot: 50 };
    const mod = getModifier(db, "heroic");
    const scaled = applyDifficulty(enc, mod);
    assert.equal(scaled.damage, 150);
    assert.equal(scaled.health, 1500);
    assert.equal(scaled.loot, 75);
    assert.equal(enc.damage, 100, "base unmodified");
  });
});

describe("Phase BD2 — prerequisite chain", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("finder is always unlocked, even with no clears", () => {
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "finder"), true);
  });

  it("normal requires finder clear of THIS encounter", () => {
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "normal"), false);
    recordClear(db, "u1", "boss-a", "finder");
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "normal"), true);
  });

  it("heroic requires normal clear, mythic requires heroic", () => {
    recordClear(db, "u1", "boss-a", "finder");
    recordClear(db, "u1", "boss-a", "normal");
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "heroic"), true);
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "mythic"), false);
    recordClear(db, "u1", "boss-a", "heroic");
    assert.equal(tierUnlockedFor(db, "u1", "boss-a", "mythic"), true);
  });

  it("clears are per-encounter (clearing boss-a doesn't unlock boss-b)", () => {
    recordClear(db, "u1", "boss-a", "finder");
    assert.equal(tierUnlockedFor(db, "u1", "boss-b", "normal"), false);
  });

  it("recordClear is idempotent on PK", () => {
    recordClear(db, "u1", "boss-a", "finder");
    const r = recordClear(db, "u1", "boss-a", "finder");
    assert.equal(r.ok, true);
    const count = db.prepare(`SELECT COUNT(*) as n FROM difficulty_clears WHERE user_id=? AND encounter_id=?`).get("u1", "boss-a").n;
    assert.equal(count, 1);
  });

  it("invalid tier in recordClear is rejected", () => {
    const r = recordClear(db, "u1", "boss-a", "ultimate");
    assert.equal(r.ok, false);
  });
});
