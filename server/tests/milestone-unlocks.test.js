// Content pillar 3 — lore milestones → immutable ledger. Completing a legendary
// task (a quest carrying a skill_unlock / faction_modifier reward) stamps a
// permanent, idempotent unlock onto the player via grantUnlock, wired into the
// live claimQuestRewards path. Pins the stamp, the idempotency (re-claim / replay
// never double-grants), and the read helpers.
//
// Run: node --test tests/milestone-unlocks.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { grantUnlock, hasUnlock, listUnlocks } from "../lib/milestone-unlocks.js";
import { addQuestRewards, claimQuestRewards } from "../lib/quests/quest-engine.js";

function completedQuest(db, { userId = "u1", worldId = "concordia-hub", questId = "q_legendary" } = {}) {
  db.prepare(`INSERT INTO player_quests (id, user_id, quest_id, world_id, status, completed_at)
              VALUES (?, ?, ?, ?, 'completed', unixepoch())`).run(`pq_${questId}`, userId, questId, worldId);
  return { userId, worldId, questId };
}

test("grantUnlock stamps once and is idempotent on ref_id", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const args = { userId: "u1", kind: "skill_unlock", key: "dtu_swordsmanship_v1", source: "quest:q1", refId: "quest:q1:u1:skill" };

  const a = grantUnlock(db, args);
  assert.equal(a.granted, true);
  const b = grantUnlock(db, args); // replay — same ref_id
  assert.equal(b.granted, false);
  assert.equal(b.alreadyHad, true);

  assert.equal(hasUnlock(db, "u1", "skill_unlock", "dtu_swordsmanship_v1"), true);
  assert.equal(listUnlocks(db, "u1").length, 1, "one row, not two");
  db.close();
});

test("claimQuestRewards stamps a skill_unlock + faction_modifier reward", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const { userId, worldId, questId } = completedQuest(db);

  addQuestRewards(db, questId, [
    { rewardType: "skill_unlock", rewardKey: "dtu_lattice_arc_v1", amount: 1 },
    { rewardType: "faction_modifier", rewardKey: "refusal_keep", amount: 25 },
    { rewardType: "gold", rewardKey: null, amount: 100 },
  ]);

  const res = claimQuestRewards(db, userId, worldId, questId);
  assert.equal(res.ok, true);

  assert.equal(hasUnlock(db, userId, "skill_unlock", "dtu_lattice_arc_v1"), true, "skill branch unlocked");
  assert.equal(hasUnlock(db, userId, "faction_modifier", "refusal_keep"), true, "faction modifier stamped");
  // The reward summary reflects the grants.
  const skillGrant = res.rewards.find((g) => g.type === "skill_unlock");
  assert.equal(skillGrant.granted, true);
  db.close();
});

test("re-claiming the same quest does not double-stamp (status + ref_id both guard)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const { userId, worldId, questId } = completedQuest(db);
  addQuestRewards(db, questId, [{ rewardType: "skill_unlock", rewardKey: "dtu_swordsmanship_v1", amount: 1 }]);

  claimQuestRewards(db, userId, worldId, questId);
  // Second claim is blocked by rewarded_at...
  const second = claimQuestRewards(db, userId, worldId, questId);
  assert.equal(second.ok, false);
  // ...and even if the status guard were bypassed, the ref_id would dedupe:
  assert.equal(listUnlocks(db, userId, "skill_unlock").length, 1, "exactly one unlock stamped");
  db.close();
});
