/**
 * BUG A regression — getSkillTreeForActor against the REAL migration schema.
 *
 * The prior code queried skill_revisions.owner_user_id / skill_id /
 * mastery_score — columns that don't exist in migration 126 (recipe_dtu_id /
 * author_kind / author_id / revision_num). Production threw `no such column`
 * for the player branch while a fabricated test schema kept the unit test green.
 *
 * This test builds the ACTUAL tables (064 player_skill_levels + 126
 * skill_revisions) and asserts the player tree returns real rows without
 * throwing — the prerequisite for per-skill combat mastery.
 *
 * Run: node --test tests/integration/skill-tree-real-schema.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../../migrations/064_crafting_and_skills.js";
import { up as up126 } from "../../migrations/126_skill_evolution.js";
import { getSkillTreeForActor } from "../../lib/skill-tree-engine.js";

function setupDb() {
  const db = new Database(":memory:");
  up064(db);
  up126(db);
  return db;
}

describe("BUG A — skill tree against real migration schema", () => {
  it("does NOT throw for a player and returns real player_skill_levels data", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp)
      VALUES ('psl1', 'alice', 'swords', 'concordia-hub', 7, 420)
    `).run();
    db.prepare(`
      INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp)
      VALUES ('psl2', 'alice', 'cooking', 'concordia-hub', 3, 150)
    `).run();

    let tree;
    assert.doesNotThrow(() => { tree = getSkillTreeForActor(db, "player", "alice"); });
    assert.equal(tree.ok, true);
    assert.equal(tree.skills.swords.level, 7);
    assert.equal(tree.skills.swords.xp, 420);
    assert.equal(tree.skills.swords.source, "player_skill_levels");
    assert.equal(tree.skills.cooking.level, 3);
    assert.equal(tree.totalLevel, 10);
  });

  it("does NOT throw when skill_revisions has only the real (skill_id-less) schema", () => {
    const db = setupDb();
    // Insert a real revision row (keyed by recipe_dtu_id + author, no skill_id).
    db.prepare(`
      INSERT INTO skill_revisions
        (id, recipe_dtu_id, revision_num, level_at_revision, author_kind, author_id, description, composer)
      VALUES ('rev1', 'dtu_water_gun', 4, 10, 'player', 'alice', 'evolved', 'deterministic')
    `).run();
    assert.doesNotThrow(() => getSkillTreeForActor(db, "player", "alice"));
    assert.doesNotThrow(() => getSkillTreeForActor(db, "npc", "npc_a"));
  });

  it("still surfaces the full catalog at level 0 when the player has no data", () => {
    const db = setupDb();
    const tree = getSkillTreeForActor(db, "player", "nobody");
    assert.equal(tree.ok, true);
    assert.ok(tree.groups.combat, "catalog groups present");
  });
});
