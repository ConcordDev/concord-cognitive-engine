/**
 * T3.1 — per-skill mastery + per-skill VFX.
 *
 * Pins:
 *   - mastery tiers grade by level (novice → grandmaster) with monotonic bonuses
 *   - progress-to-next is correct inside a tier band and saturates at the cap
 *   - the per-skill VFX descriptor scales with mastery (more particles, bigger
 *     scale, finisher unlock at expert+) and carries the element palette
 *   - getSkillMastery / getAllSkillMastery read player_skill_levels and
 *     aggregate across world-types (MAX level, SUM xp)
 *   - an untrained skill reads as level-0 novice (no throw, no null)
 *
 * Run: node --test tests/integration/skill-mastery.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { up as up064 } from "../../migrations/064_crafting_and_skills.js";
import {
  MASTERY_TIERS, ELEMENT_VFX,
  masteryForLevel, skillVfxDescriptor,
  getSkillMastery, getAllSkillMastery,
} from "../../lib/skills/skill-mastery.js";

function freshDb() {
  const db = new Database(":memory:");
  up064(db);
  return db;
}

function addSkill(db, userId, skillType, worldType, level, xp) {
  db.prepare(`
    INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp, xp_to_next)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, skillType, worldType, level, xp, 100);
}

describe("T3.1 — mastery tiers", () => {
  it("grades by level across the full range", () => {
    assert.equal(masteryForLevel(0).tier, "novice");
    assert.equal(masteryForLevel(9).tier, "novice");
    assert.equal(masteryForLevel(10).tier, "apprentice");
    assert.equal(masteryForLevel(25).tier, "adept");
    assert.equal(masteryForLevel(45).tier, "expert");
    assert.equal(masteryForLevel(70).tier, "master");
    assert.equal(masteryForLevel(95).tier, "grandmaster");
    assert.equal(masteryForLevel(120).tier, "grandmaster");
  });

  it("bonuses are monotonic across tiers", () => {
    for (let i = 1; i < MASTERY_TIERS.length; i++) {
      assert.ok(MASTERY_TIERS[i].potency >= MASTERY_TIERS[i - 1].potency);
      assert.ok(MASTERY_TIERS[i].poiseBonus >= MASTERY_TIERS[i - 1].poiseBonus);
      assert.ok(MASTERY_TIERS[i].frameSpeed <= MASTERY_TIERS[i - 1].frameSpeed, "frames get faster");
    }
    assert.equal(masteryForLevel(0).bonuses.finisherUnlocked, false);
    assert.equal(masteryForLevel(45).bonuses.finisherUnlocked, true);
  });

  it("progress-to-next is correct mid-band and saturates at cap", () => {
    // halfway between apprentice(10) and adept(25) is level ~17.5 → 0.5
    const mid = masteryForLevel(17);
    assert.equal(mid.tier, "apprentice");
    assert.ok(mid.progressToNext > 0.4 && mid.progressToNext < 0.6);
    assert.equal(mid.nextTier, "adept");
    assert.equal(mid.nextTierAtLevel, 25);
    // grandmaster has no next tier
    const cap = masteryForLevel(100);
    assert.equal(cap.nextTier, null);
    assert.equal(cap.progressToNext, 1);
    assert.equal(cap.levelsToNext, 0);
  });

  it("clamps negative / NaN levels to novice", () => {
    assert.equal(masteryForLevel(-5).tier, "novice");
    assert.equal(masteryForLevel(NaN).tier, "novice");
  });
});

describe("T3.1 — per-skill VFX descriptor", () => {
  it("scales particle count + scale with mastery tier", () => {
    const novice = skillVfxDescriptor({ element: "fire", level: 1 });
    const gm = skillVfxDescriptor({ element: "fire", level: 100 });
    assert.ok(gm.particles.count > novice.particles.count);
    assert.ok(gm.particles.scale > novice.particles.scale);
    assert.ok(gm.glow >= novice.glow);
    assert.equal(novice.finisherFlourish, false);
    assert.equal(gm.finisherFlourish, true);
  });

  it("carries the element palette", () => {
    const v = skillVfxDescriptor({ element: "ice", level: 30 });
    assert.deepEqual(v.palette, ELEMENT_VFX.ice);
    assert.equal(v.tier, "adept");
    // unknown element falls back to the neutral palette
    assert.deepEqual(skillVfxDescriptor({ element: "zzz", level: 0 }).palette, ELEMENT_VFX.none);
  });
});

describe("T3.1 — DB reads over player_skill_levels", () => {
  it("getSkillMastery aggregates across world-types", () => {
    const db = freshDb();
    const u = "user-1";
    addSkill(db, u, "combat", "concordia-hub", 30, 1200);
    addSkill(db, u, "combat", "tunya", 48, 800); // higher level here
    const m = getSkillMastery(db, u, "combat", { element: "physical" });
    assert.equal(m.level, 48, "takes MAX level across worlds");
    assert.equal(m.xp, 2000, "sums xp across worlds");
    assert.equal(m.tier, "expert");
    assert.equal(m.vfx.element, "physical");
    db.close();
  });

  it("untrained skill reads as level-0 novice (no throw)", () => {
    const db = freshDb();
    const m = getSkillMastery(db, "nobody", "arcana");
    assert.equal(m.level, 0);
    assert.equal(m.tier, "novice");
    assert.equal(m.xp, 0);
    db.close();
  });

  it("getAllSkillMastery lists a user's skills highest-level first", () => {
    const db = freshDb();
    const u = "user-2";
    addSkill(db, u, "combat", "tunya", 12, 100);
    addSkill(db, u, "arcana", "tunya", 72, 500);
    addSkill(db, u, "survival", "tunya", 5, 50);
    const all = getAllSkillMastery(db, u);
    assert.equal(all.length, 3);
    assert.equal(all[0].skillType, "arcana");
    assert.equal(all[0].tier, "master");
    assert.equal(all[2].skillType, "survival");
    assert.equal(all[2].tier, "novice");
    db.close();
  });

  it("getAllSkillMastery returns [] when the table is absent", () => {
    const bare = new Database(":memory:");
    assert.deepEqual(getAllSkillMastery(bare, "x"), []);
    bare.close();
  });
});
