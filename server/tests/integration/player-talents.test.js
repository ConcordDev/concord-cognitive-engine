/**
 * F2.3 — player talent allocation.
 *
 * Pins:
 *   - levelling grants talent points (the gainSkillXP hook)
 *   - spend validates available points, max rank, and prerequisites
 *   - allocations persist + drive combat bonuses (read like affixes)
 *   - talentDamageFor folds melee % + matching-element % + flat power
 *
 * Run: node --test tests/integration/player-talents.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../../migrations/064_crafting_and_skills.js";
import { up as up265 } from "../../migrations/265_player_talents.js";
import {
  grantTalentPoints, getTalents, spendTalentPoint, talentDamageFor,
} from "../../lib/talents.js";
import { gainSkillXP } from "../../lib/skills/skill-engine.js";

function freshDb() {
  const db = new Database(":memory:");
  up064(db); up265(db);
  return db;
}

describe("F2.3 — earning points", () => {
  it("gainSkillXP grants a talent point per level", () => {
    const db = freshDb();
    // 100 XP at xp_to_next 100 → level 1→2 (1 level gained).
    const r = gainSkillXP(db, "u1", "swords", "concordia-hub", 100, { worldId: "concordia-hub" });
    assert.ok(r.levelsGained >= 1);
    const t = getTalents(db, "u1");
    assert.equal(t.available, r.levelsGained);
    assert.equal(t.earned, r.levelsGained);
    db.close();
  });

  it("grantTalentPoints accumulates", () => {
    const db = freshDb();
    grantTalentPoints(db, "u2", 3);
    grantTalentPoints(db, "u2", 2);
    assert.equal(getTalents(db, "u2").available, 5);
    db.close();
  });
});

describe("F2.3 — spending", () => {
  it("spends a point and persists the allocation", () => {
    const db = freshDb();
    grantTalentPoints(db, "u1", 5);
    const r = spendTalentPoint(db, "u1", "bladework");
    assert.equal(r.ok, true);
    assert.equal(r.newRank, 1);
    const t = getTalents(db, "u1");
    assert.equal(t.allocations.bladework, 1);
    assert.equal(t.available, 4);
    assert.equal(t.spent, 1);
    db.close();
  });

  it("rejects spending with no points", () => {
    const db = freshDb();
    const r = spendTalentPoint(db, "u1", "bladework");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_points");
    db.close();
  });

  it("enforces max rank", () => {
    const db = freshDb();
    grantTalentPoints(db, "u1", 10);
    spendTalentPoint(db, "u1", "executioner_none"); // unknown
    // executioner has maxRank 1 but requires heavy_hands 2 (which requires bladework 2)
    spendTalentPoint(db, "u1", "bladework");
    spendTalentPoint(db, "u1", "bladework");
    spendTalentPoint(db, "u1", "bladework");
    const over = spendTalentPoint(db, "u1", "bladework"); // maxRank 3
    assert.equal(over.ok, false);
    assert.equal(over.reason, "max_rank");
    db.close();
  });

  it("enforces prerequisites", () => {
    const db = freshDb();
    grantTalentPoints(db, "u1", 10);
    const blocked = spendTalentPoint(db, "u1", "executioner"); // needs heavy_hands 2
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "prereq_unmet");
    db.close();
  });
});

describe("F2.3 — combat bonuses", () => {
  it("allocated talents fold into the damage multiplier + flat power", () => {
    const db = freshDb();
    grantTalentPoints(db, "u1", 10);
    spendTalentPoint(db, "u1", "bladework");   // +4% melee
    spendTalentPoint(db, "u1", "bladework");   // +8% melee total
    spendTalentPoint(db, "u1", "fire_focus");  // +5% fire
    const fire = talentDamageFor(db, "u1", "fire");
    assert.ok(Math.abs(fire.multiplier - 1.13) < 0.001, `expected 1.13, got ${fire.multiplier}`); // 1 + 0.08 + 0.05
    const ice = talentDamageFor(db, "u1", "ice");
    assert.ok(Math.abs(ice.multiplier - 1.08) < 0.001); // melee only, no ice focus
    db.close();
  });
});
