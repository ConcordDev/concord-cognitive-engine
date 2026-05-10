/**
 * Tier-2 contract tests for Sprint C / Track C4 — player oxygen.
 *
 * Pins:
 *   - tickOxygen creates a row at 100% on first call
 *   - submerged depth depletes 1%/sec
 *   - surface refills 5%/sec, capped at 100
 *   - oxygen=0 + still submerged accumulates drowning_damage
 *   - resetOxygen clears damage + refills to 100
 *
 * Run: node --test tests/oxygen.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { tickOxygen, resetOxygen, getOxygen, OXYGEN_CONSTANTS } from "../lib/embodied/oxygen.js";
import { up as up157 } from "../migrations/157_player_oxygen.js";

function setupDb() {
  const db = new Database(":memory:");
  up157(db);
  return db;
}

describe("Sprint C / C4 — tickOxygen", () => {
  it("creates a row at 100 on first call", () => {
    const db = setupDb();
    const r = tickOxygen(db, "u1", "concordia-hub", 0);
    assert.equal(r.action, "init");
    assert.equal(r.oxygen_pct, 100);
    const row = getOxygen(db, "u1", "concordia-hub");
    assert.equal(row.oxygen_pct, 100);
  });

  it("submerged depletes oxygen", () => {
    const db = setupDb();
    tickOxygen(db, "u1", "concordia-hub", 5); // init at depth 5
    // Backdate by 10s.
    db.prepare(`UPDATE player_oxygen SET last_breath_at = unixepoch() - 10 WHERE user_id = ?`).run("u1");
    const r = tickOxygen(db, "u1", "concordia-hub", 5);
    assert.equal(r.submerged, true);
    // 100 - 1*10 = 90.
    assert.ok(r.oxygen_pct <= 91 && r.oxygen_pct >= 89, `got ${r.oxygen_pct}`);
  });

  it("surface refills oxygen", () => {
    const db = setupDb();
    tickOxygen(db, "u1", "concordia-hub", 5);
    db.prepare(`UPDATE player_oxygen SET oxygen_pct = 50, last_breath_at = unixepoch() - 5 WHERE user_id = ?`).run("u1");
    const r = tickOxygen(db, "u1", "concordia-hub", 0);
    assert.equal(r.submerged, false);
    // 50 + 5*5 = 75.
    assert.ok(r.oxygen_pct >= 74 && r.oxygen_pct <= 76, `got ${r.oxygen_pct}`);
  });

  it("oxygen=0 + submerged accumulates drowning damage", () => {
    const db = setupDb();
    tickOxygen(db, "u1", "concordia-hub", 5);
    db.prepare(`UPDATE player_oxygen SET oxygen_pct = 0, last_breath_at = unixepoch() - 4 WHERE user_id = ?`).run("u1");
    const r = tickOxygen(db, "u1", "concordia-hub", 5);
    assert.equal(r.drowning, true);
    assert.ok(r.drowning_damage_added >= 4, `expected ≥ 4, got ${r.drowning_damage_added}`);
  });

  it("suggestSignal fires under low-oxygen threshold", () => {
    const db = setupDb();
    tickOxygen(db, "u1", "concordia-hub", 5);
    db.prepare(`UPDATE player_oxygen SET oxygen_pct = 25, last_breath_at = unixepoch() - 1 WHERE user_id = ?`).run("u1");
    const r = tickOxygen(db, "u1", "concordia-hub", 5);
    assert.equal(r.suggestSignal, true);
  });

  it("resetOxygen restores 100 and clears damage", () => {
    const db = setupDb();
    tickOxygen(db, "u1", "concordia-hub", 0);
    db.prepare(`UPDATE player_oxygen SET oxygen_pct = 5, drowning_damage = 80 WHERE user_id = ?`).run("u1");
    resetOxygen(db, "u1", "concordia-hub");
    const row = getOxygen(db, "u1", "concordia-hub");
    assert.equal(row.oxygen_pct, 100);
    assert.equal(row.drowning_damage, 0);
  });
});

describe("Sprint C / C4 — constants", () => {
  it("exposes thresholds", () => {
    assert.equal(OXYGEN_CONSTANTS.SUBMERGED_THRESHOLD_M, 0.3);
    assert.equal(OXYGEN_CONSTANTS.LOW_OXYGEN_THRESHOLD, 30);
  });
});
