/**
 * D30 — endgame paragon/ascension loop.
 *
 * Pins:
 *   - XP at the skill cap (previously discarded) feeds ascension via gainSkillXP
 *   - ascension levels grant points; points buy ranked permanent nodes
 *   - spend validates available points + max rank
 *   - allocated nodes fold into the combat damage multiplier
 *
 * Run: node --test tests/integration/ascension-endgame.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../../migrations/064_crafting_and_skills.js";
import { up as up265 } from "../../migrations/265_player_talents.js";
import { up as up266 } from "../../migrations/266_player_ascension.js";
import {
  gainAscensionXp, getAscension, spendAscensionPoint, ascensionDamageMultiplier,
  ASCENSION_XP_PER_LEVEL,
} from "../../lib/ascension.js";
import { gainSkillXP } from "../../lib/skills/skill-engine.js";

function freshDb() {
  const db = new Database(":memory:");
  up064(db); up265(db); up266(db);
  return db;
}

describe("D30 — skill-cap XP feeds ascension", () => {
  it("gainSkillXP at level 100 routes overflow into ascension (not discarded)", () => {
    const db = freshDb();
    // Seed a capped skill row directly.
    db.prepare(`
      INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp, xp_to_next)
      VALUES ('s1', 'u1', 'swords', 'concordia-hub', 100, 0, 100)
    `).run();
    const r = gainSkillXP(db, "u1", "swords", "concordia-hub", ASCENSION_XP_PER_LEVEL * 2, { worldId: "concordia-hub" });
    assert.equal(r.atCap, true);
    assert.ok(r.ascension && r.ascension.levelsGained === 2);
    const a = getAscension(db, "u1");
    assert.equal(a.level, 2);
    assert.equal(a.available, 2);
    db.close();
  });
});

describe("D30 — earning + spending", () => {
  it("levels accrue points; spend ranks a node", () => {
    const db = freshDb();
    gainAscensionXp(db, "u1", ASCENSION_XP_PER_LEVEL * 5);
    let a = getAscension(db, "u1");
    assert.equal(a.level, 5);
    assert.equal(a.available, 5);
    const r = spendAscensionPoint(db, "u1", "paragon_might");
    assert.equal(r.ok, true);
    assert.equal(r.newRank, 1);
    a = getAscension(db, "u1");
    assert.equal(a.allocations.paragon_might, 1);
    assert.equal(a.available, 4);
    assert.equal(a.spent, 1);
    db.close();
  });

  it("rejects spend with no points + unknown node", () => {
    const db = freshDb();
    assert.equal(spendAscensionPoint(db, "u1", "paragon_might").reason, "no_points");
    gainAscensionXp(db, "u1", ASCENSION_XP_PER_LEVEL);
    assert.equal(spendAscensionPoint(db, "u1", "nope").reason, "unknown_node");
    db.close();
  });
});

describe("D30 — combat fold", () => {
  it("paragon nodes raise the damage multiplier", () => {
    const db = freshDb();
    gainAscensionXp(db, "u1", ASCENSION_XP_PER_LEVEL * 20);
    for (let i = 0; i < 10; i++) spendAscensionPoint(db, "u1", "paragon_might");   // 10 × 0.004 = 0.04 melee
    for (let i = 0; i < 5; i++) spendAscensionPoint(db, "u1", "paragon_arcane");   // 5 × 0.004 = 0.02 all-element
    const fire = ascensionDamageMultiplier(db, "u1", "fire");  // 1 + 0.04 + 0.02
    assert.ok(Math.abs(fire - 1.06) < 0.001, `expected 1.06, got ${fire}`);
    const none = ascensionDamageMultiplier(db, "u1", "none");  // melee only
    assert.ok(Math.abs(none - 1.04) < 0.001, `expected 1.04, got ${none}`);
    db.close();
  });
});
