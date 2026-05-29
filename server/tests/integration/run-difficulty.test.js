/**
 * C2 / F4.2 — difficulty tiers for run-modes.
 *
 * difficulty.js#applyDifficulty was world-boss-only. This pins the run wrapper:
 *   - finder is always unlocked; higher tiers gate on a prior clear of the mode
 *   - resolveRunDifficulty returns the tier modifier (scales enemy stats)
 *   - a run cleared at a tier unlocks the next (recordRunClear)
 *   - startRun rejects a locked tier; accepts finder
 *
 * Run: node --test tests/integration/run-difficulty.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up241 } from "../../migrations/241_difficulty_tiers.js";
import { up as up245 } from "../../migrations/245_roguelite_runs.js";
import {
  resolveRunDifficulty, scaleRunEncounter, recordRunClear, runEncounterId,
} from "../../lib/run-difficulty.js";
import { startRun } from "../../lib/roguelite.js";

function freshDb() {
  const db = new Database(":memory:");
  up241(db); up245(db);
  db.prepare(`INSERT INTO roguelite_meta_currency (user_id, balance, lifetime) VALUES ('u1', 0, 0)`).run();
  return db;
}

describe("C2 — tier gating", () => {
  it("finder is open; heroic is locked until normal is cleared", () => {
    const db = freshDb();
    assert.equal(resolveRunDifficulty(db, "u1", "roguelite", "finder").ok, true);
    assert.equal(resolveRunDifficulty(db, "u1", "roguelite", "heroic").reason, "tier_locked");
    // clear normal → heroic unlocks
    recordRunClear(db, "u1", "roguelite", "normal");
    assert.equal(resolveRunDifficulty(db, "u1", "roguelite", "heroic").ok, true);
    db.close();
  });

  it("the modifier scales enemy stats", () => {
    const db = freshDb();
    const r = resolveRunDifficulty(db, "u1", "roguelite", "finder");
    assert.ok(r.modifier, "finder modifier row seeded by migration 241");
    const scaled = scaleRunEncounter({ damage: 10, health: 100, loot: 5 }, r.modifier);
    assert.equal(typeof scaled.health, "number");
    assert.equal(scaled.tier, "finder");
    db.close();
  });
});

describe("C2 — startRun honours the tier", () => {
  it("rejects a locked tier, accepts finder + returns the difficulty modifier", () => {
    const db = freshDb();
    const locked = startRun(db, "u1", { worldId: "w1", regionId: "r1", tier: "mythic" });
    assert.equal(locked.ok, false);
    assert.equal(locked.error, "tier_locked");

    const ok = startRun(db, "u1", { worldId: "w1", regionId: "r1", tier: "finder" });
    assert.equal(ok.ok, true);
    assert.equal(ok.tier, "finder");
    assert.ok(ok.difficulty, "difficulty modifier returned");
    db.close();
  });

  it("runEncounterId is per-mode", () => {
    assert.equal(runEncounterId("roguelite"), "run:roguelite");
    assert.equal(runEncounterId("horde"), "run:horde");
  });
});
