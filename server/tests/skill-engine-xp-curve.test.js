/**
 * Progression Matrix — System A XP-curve contract.
 *
 * Pins the exact leveling formula in lib/skills/skill-engine.js#gainSkillXP:
 *   - a fresh skill seeds level 1 with xp_to_next = 100
 *   - the per-level threshold is xp_to_next = 100 * level (linear-in-level)
 *   - cumulative cost L1 -> LN is 50 * N * (N - 1) (closed form of sum 100*L)
 *   - the hard cap is level 100 (overflow routes to ascension, pinned elsewhere
 *     by tests/integration/ascension-endgame.test.js)
 *
 * This curve was previously only exercised indirectly; docs/PROGRESSION_MATRIX.md
 * cites this file as the formula's pin.
 *
 * Run: node --test tests/skill-engine-xp-curve.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../migrations/064_crafting_and_skills.js";
import { gainSkillXP } from "../lib/skills/skill-engine.js";

function freshDb() {
  const db = new Database(":memory:");
  up064(db);
  return db;
}

function readRow(db, userId, skillType, worldType) {
  return db
    .prepare(
      "SELECT level, xp, xp_to_next FROM player_skill_levels WHERE user_id = ? AND skill_type = ? AND native_world_type = ?"
    )
    .get(userId, skillType, worldType);
}

describe("System A XP curve — xp_to_next = 100 * level", () => {
  it("a fresh skill seeds level 1 with xp_to_next = 100", () => {
    const db = freshDb();
    gainSkillXP(db, "u1", "swords", "standard", 0);
    const row = readRow(db, "u1", "swords", "standard");
    assert.equal(row.level, 1);
    assert.equal(row.xp, 0);
    assert.equal(row.xp_to_next, 100);
    db.close();
  });

  it("exactly 100 XP levels 1 -> 2 and sets xp_to_next = 200", () => {
    const db = freshDb();
    const r = gainSkillXP(db, "u1", "swords", "standard", 100);
    assert.equal(r.leveled, true);
    assert.equal(r.newLevel, 2);
    assert.equal(r.newXp, 0);
    const row = readRow(db, "u1", "swords", "standard");
    assert.equal(row.level, 2);
    assert.equal(row.xp, 0);
    assert.equal(row.xp_to_next, 200);
    db.close();
  });

  it("partial overflow carries: 150 XP from L1 -> level 2 with 50 banked", () => {
    const db = freshDb();
    const r = gainSkillXP(db, "u1", "axes", "standard", 150);
    assert.equal(r.newLevel, 2);
    assert.equal(r.newXp, 50);
    const row = readRow(db, "u1", "axes", "standard");
    assert.equal(row.xp, 50);
    assert.equal(row.xp_to_next, 200);
    db.close();
  });

  it("multi-level cascade: 600 XP from L1 -> exactly level 4 (100+200+300)", () => {
    const db = freshDb();
    const r = gainSkillXP(db, "u1", "smithing", "standard", 600);
    assert.equal(r.newLevel, 4);
    assert.equal(r.newXp, 0);
    assert.equal(r.levelsGained, 3);
    const row = readRow(db, "u1", "smithing", "standard");
    assert.equal(row.xp_to_next, 400);
    db.close();
  });

  it("closed form: 4500 XP from L1 -> exactly level 10 (50*10*9)", () => {
    const db = freshDb();
    const r = gainSkillXP(db, "u1", "alchemy", "standard", 4500);
    assert.equal(r.newLevel, 10);
    assert.equal(r.newXp, 0);
    const row = readRow(db, "u1", "alchemy", "standard");
    assert.equal(row.level, 10);
    assert.equal(row.xp_to_next, 1000);
    db.close();
  });

  it("hard cap: a level-100 row reports atCap and does not level", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp, xp_to_next)
       VALUES ('s1', 'u1', 'swords', 'standard', 100, 0, 100)`
    ).run();
    const r = gainSkillXP(db, "u1", "swords", "standard", 5000);
    assert.equal(r.atCap, true);
    assert.equal(r.newLevel, 100);
    const row = readRow(db, "u1", "swords", "standard");
    assert.equal(row.level, 100);
    db.close();
  });
});
