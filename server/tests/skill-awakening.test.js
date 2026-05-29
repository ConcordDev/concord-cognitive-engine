/**
 * WS4(b) — awakening + specialization tests (Deku/Bakugo power growth).
 * Run: node --test tests/skill-awakening.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  SPECIALIZATIONS, applySpecialization, computeAwakening, isNearDeath, AWAKENING_DIALS,
} from "../lib/skill-awakening.js";
import registerSkillAwakeningMacros from "../domains/skill-awakening.js";
import { ensureSkillsTable, bootEmergentSkills, getSkill } from "../lib/emergent-skills.js";

const explosion = { name: "Explosion", element: "fire", maxDamage: 40, rangeM: 10, cooldownMs: 3000, aoeRadius: 3 };

describe("specialization (Bakugo modes)", () => {
  it("AP Shot is precision (more single-target dmg, less aoe)", () => {
    const r = applySpecialization(explosion, "precision");
    assert.ok(r.ok);
    assert.ok(r.skill.maxDamage > explosion.maxDamage);
    assert.ok(r.skill.aoeRadius < explosion.aoeRadius);
    assert.match(r.skill.name, /AP Shot/);
  });
  it("Howitzer is area (bigger aoe, less per-hit dmg)", () => {
    const r = applySpecialization(explosion, "area");
    assert.ok(r.skill.aoeRadius > explosion.aoeRadius);
    assert.ok(r.skill.maxDamage < explosion.maxDamage);
  });
  it("rejects an unknown branch and lists options", () => {
    const r = applySpecialization(explosion, "nope");
    assert.equal(r.ok, false);
    assert.ok(r.branches.includes("precision"));
  });
  it("re-specializing strips the prior suffix (no stacking names)", () => {
    const ap = applySpecialization(explosion, "precision").skill;
    const how = applySpecialization(ap, "area").skill;
    assert.match(how.name, /Explosion \(Howitzer\)/);
  });
});

describe("awakening (stress trigger)", () => {
  it("near-death detection respects the HP fraction", () => {
    assert.equal(isNearDeath(5, 100), true);   // 5% ≤ 10%
    assert.equal(isNearDeath(50, 100), false);
    assert.equal(isNearDeath(0, 100), false);   // dead, not awakened
  });
  it("computes a permanent spike + a deterministic branch unlock", () => {
    const a = computeAwakening(explosion, "near_death_survived", "u1");
    assert.ok(a.ok && a.awakened);
    assert.equal(a.multiplier, AWAKENING_DIALS.nearDeathMult);
    assert.equal(a.newMaxDamage, Math.round(40 * AWAKENING_DIALS.nearDeathMult));
    assert.ok(Object.keys(SPECIALIZATIONS).includes(a.unlockedBranch));
    // deterministic
    assert.equal(computeAwakening(explosion, "near_death_survived", "u1").unlockedBranch, a.unlockedBranch);
  });
  it("rejects unknown triggers", () => {
    assert.equal(computeAwakening(explosion, "stubbed_toe").ok, false);
  });
});

describe("skill-awakening macros", () => {
  function registry() {
    const m = new Map();
    registerSkillAwakeningMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    return m;
  }
  it("specialize persists when authed + persist:true", async () => {
    const db = new Database(":memory:");
    ensureSkillsTable(db); bootEmergentSkills(db);
    const m = registry();
    const r = await m.get("skill-awakening.specialize")(
      { db, actor: { userId: "u1" } },
      { skill: explosion, branch: "precision", persist: true },
    );
    assert.ok(r.ok && r.skillId);
    assert.ok(getSkill(r.skillId));
  });
  it("awaken returns the spike without persisting by default", async () => {
    const m = registry();
    const r = await m.get("skill-awakening.awaken")({}, { skill: explosion, trigger: "named_threat_defeated" });
    assert.ok(r.ok);
    assert.ok(r.skill.maxDamage > explosion.maxDamage);
    assert.equal(r.skillId, null);
  });
});
