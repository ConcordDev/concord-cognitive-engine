/**
 * Living Society — Phase 8: per-world reskin (the load-bearing mechanics).
 *
 *   - Mastery-as-passport: a hostile world nullifies a low-mastery off-affinity
 *     skill, but a grandmaster (tier 5) still fires it REDUCED (not nullified).
 *   - Authored tyranny seeds standing grievances → a movement auto-seeds from
 *     the injustice on the recruitment pass.
 *
 * Run: node --test tests/per-world-reskin.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { computeSkillEffectiveness } from "../lib/skills/skill-engine.js";
import { masteryForLevel } from "../lib/skills/skill-mastery.js";
import { up as up284 } from "../migrations/284_movements.js";
import { seedTyrannyGrievances } from "../lib/npc-asymmetry.js";
import { seedMovementFromGrievance, getMovement } from "../lib/movements.js";

// A no-magic world: magic is fully damped (multiplier 0).
const NO_MAGIC_RULES = { skill_effectiveness_rules: { magic: { multiplier: 0.0 } } };

describe("Phase 8 — mastery-as-passport", () => {
  it("a low-mastery off-affinity skill is nullified in a hostile world", () => {
    const novice = masteryForLevel(8); // novice/apprentice
    const r = computeSkillEffectiveness("magic", 8, NO_MAGIC_RULES, { masteryTierIndex: novice.tierIndex });
    assert.equal(r.effective, false);
    assert.equal(r.effectiveLevel, 0);
  });

  it("a grandmaster still fires the same skill REDUCED, not nullified", () => {
    const gm = masteryForLevel(98); // grandmaster, tierIndex 5
    assert.equal(gm.tier, "grandmaster");
    const r = computeSkillEffectiveness("magic", 98, NO_MAGIC_RULES, { masteryTierIndex: gm.tierIndex });
    assert.equal(r.effective, true, "grandmaster overcomes the damping");
    assert.equal(r.masteryPassport, true);
    assert.ok(r.effectiveLevel > 0 && r.effectiveLevel < 98, `reduced: ${r.effectiveLevel}`);
  });

  it("the passport floor rises with mastery tier", () => {
    const expert = computeSkillEffectiveness("magic", 50, NO_MAGIC_RULES, { masteryTierIndex: 3 });
    const master = computeSkillEffectiveness("magic", 50, NO_MAGIC_RULES, { masteryTierIndex: 5 });
    assert.ok(master.effectiveLevel > expert.effectiveLevel, "grandmaster > expert reduced output");
  });
});

describe("Phase 8 — authored tyranny seeds a movement", () => {
  it("a movement auto-seeds from an authored injustice", () => {
    const db = new Database(":memory:");
    up284(db);
    db.exec(`
      CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
      CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, narrative TEXT, severity INTEGER, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER);
    `);
    for (const n of ["parent_a", "parent_b", "parent_c"]) db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES (?, 'cyber')`).run(n);
    const s = seedTyrannyGrievances(db, "cyber", { tyrantKind: "faction", tyrantId: "augmented_children", aggrieved: ["parent_a", "parent_b", "parent_c"], severity: 5 });
    assert.equal(s.seeded, 3);
    const r = seedMovementFromGrievance(db, "cyber");
    assert.equal(r.seeded.length, 1);
    assert.equal(getMovement(db, r.seeded[0]).target_id, "augmented_children");
  });
});
