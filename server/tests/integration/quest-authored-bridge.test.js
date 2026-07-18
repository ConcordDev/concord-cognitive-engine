// Integration test for the authored-quest → System B bridge
// (docs/QUESTS_ENGINE_INVESTIGATION.md, Option 1 + Findings 2/3/4).
//
// The bug: 127 authored quests (content/quests/*.json) loaded ONLY into
// System A's in-memory Map (server/emergent/quest-engine.js), which no live
// gameplay surface reads. The dialogue-offer path, /api/quests/accept, the
// QuestTracker HUD, /lenses/quests, and the onboarding tutorial all read the
// SQL "System B" store (world_quests + quest_objectives + player_quests +
// player_quest_progress + quest_rewards) — which authored content never
// reached. So zero authored quests of any kind were reachable in-game.
//
// The fix bridges each authored quest into System B at seed time. This test
// proves the bridge end-to-end against a genuinely migrated in-memory DB:
//   (a) an onboarding quest (first_cycle_cook) AND a main-arc quest
//       (cracks_in_the_compact) now exist in world_quests with real
//       quest_objectives + quest_rewards rows;
//   (b) the exact dialogue-offer query returns the authored quest for its
//       giver NPC;
//   (c) accept → recordObjectiveProgress → checkQuestCompletion →
//       claimQuestRewards round-trips and grants the real authored reward
//       (amounts derived from the seeded engine rows, not pasted);
//   (d) deriveFirstCycleProgress advances past "cook" once the cook quest's
//       objectives are recorded via the real production hooks.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";

import { up as upConcordiaWorlds } from "../../migrations/042_concordia_worlds.js";
import { up as upCraftingAndSkills } from "../../migrations/064_crafting_and_skills.js";
import { up as upQuestStateMachine } from "../../migrations/068_quest_state_machine.js";
import { up as upNpcAsymmetry } from "../../migrations/128_npc_asymmetry.js";
import { seedContent } from "../../lib/content-seeder.js";
import {
  getActiveQuests,
  getCompletedQuests,
  recordObjectiveProgress,
  checkQuestCompletion,
  claimQuestRewards,
} from "../../lib/quests/quest-engine.js";
import { deriveFirstCycleProgress } from "../../lib/tutorial-first-cycle.js";

const WORLD = "concordia-hub";
// Authored JSON ids (NOT generated UUIDs) — verified against
// content/quests/{onboarding,main-arc}.json.
const COOK_QUEST_ID = "first_cycle_cook";
const COOK_GIVER = "concordia_first_breath";
const MAIN_QUEST_ID = "cracks_in_the_compact";
const MAIN_GIVER = "archivist_maren";

let db;

function migrate(database) {
  // Migration 042 ALTERs a pre-existing `player_world_state` table; provide a
  // minimal stand-in so it can run standalone (same tolerance pattern
  // content-seeder.js and the sibling quests-real-writer.test.js use).
  database.exec(`CREATE TABLE IF NOT EXISTS player_world_state (user_id TEXT);`);
  upConcordiaWorlds(database);    // worlds, world_npcs, world_quests, ...
  upCraftingAndSkills(database);  // player_skill_levels — claimQuestRewards' skill_xp path grants into it
  upQuestStateMachine(database);  // player_quests, quest_objectives, player_quest_progress, quest_rewards
  upNpcAsymmetry(database);       // npc_grudges/preoccupations/desires — content-seeder touches these best-effort
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT, title TEXT, human_summary TEXT,
      created_at INTEGER, creator_id TEXT, scope TEXT, visibility TEXT
    );
    CREATE TABLE IF NOT EXISTS factions (id TEXT PRIMARY KEY, name TEXT);
    INSERT OR IGNORE INTO users (id) VALUES ('system');
  `);
}

describe("Authored quest → System B bridge (integration)", () => {
  before(async () => {
    db = new Database(":memory:");
    migrate(db);
    await seedContent({ db });
  });
  after(() => { try { db?.close(); } catch { /* intentional */ } });

  // ── (a) authored content reaches world_quests with real objective/reward rows ──
  it("(a) an onboarding quest AND a main-arc quest reach world_quests with real quest_objectives + quest_rewards", () => {
    for (const [id, giver] of [[COOK_QUEST_ID, COOK_GIVER], [MAIN_QUEST_ID, MAIN_GIVER]]) {
      const wq = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(id);
      assert.ok(wq, `world_quests must have a row for authored quest ${id}`);
      assert.equal(wq.world_id, WORLD);
      assert.equal(wq.status, "available");
      assert.equal(wq.giver_npc_id, giver);
      assert.ok(wq.title && wq.title.length > 0);

      const objs = db.prepare("SELECT * FROM quest_objectives WHERE quest_id = ?").all(id);
      assert.ok(objs.length > 0, `quest_objectives rows must exist for ${id} (not just objectives_json)`);

      const rewards = db.prepare("SELECT * FROM quest_rewards WHERE quest_id = ?").all(id);
      assert.ok(rewards.length > 0, `quest_rewards rows must exist for ${id}`);
    }
  });

  it("(a') the main-arc objectives are faithfully mapped from the authored JSON (no fabricated steps)", () => {
    const objs = db.prepare(
      "SELECT type, target, required_count FROM quest_objectives WHERE quest_id = ? ORDER BY order_index"
    ).all(MAIN_QUEST_ID);
    // Exactly content/quests/main-arc.json's cracks_in_the_compact.objectives —
    // all four carry a flat string type+target so none are dropped.
    assert.deepEqual(objs.map((o) => [o.type, o.target, o.required_count]), [
      ["reach_location", "shadow_archive_entrance", 1],
      ["talk_to", "archivist_maren", 1],
      ["gather", "vault_manifest_fragment", 2],
      ["talk_to", "archivist_maren", 2],
    ]);
  });

  // ── (b) the live dialogue-offer query returns the authored quest for its giver ──
  it("(b) the dialogue-offer query returns the authored quest for its giver NPC", () => {
    // Byte-for-byte the query in routes/worlds.js:1129 / :1421.
    const offer = db.prepare(
      "SELECT * FROM world_quests WHERE giver_npc_id = ? AND status = 'available' LIMIT 3"
    ).all(MAIN_GIVER);
    assert.ok(offer.some((q) => q.id === MAIN_QUEST_ID), "archivist_maren must offer cracks_in_the_compact");

    const cookOffer = db.prepare(
      "SELECT * FROM world_quests WHERE giver_npc_id = ? AND status = 'available' LIMIT 3"
    ).all(COOK_GIVER);
    assert.ok(cookOffer.some((q) => q.id === COOK_QUEST_ID), "concordia_first_breath must offer first_cycle_cook");
  });

  // ── (c) full accept → progress → completion → reward-grant round-trip ──
  it("(c) accept → recordObjectiveProgress → checkQuestCompletion → claimQuestRewards grants the real authored reward", () => {
    const USER = "u_bridge_roundtrip";

    // Derive the expected reward from the seeded engine rows (System B's own
    // source of truth) — NOT pasted numbers. This is what claimQuestRewards
    // reads and grants.
    const rewardRows = db.prepare(
      "SELECT reward_type, reward_key, amount FROM quest_rewards WHERE quest_id = ?"
    ).all(MAIN_QUEST_ID);
    const expectedXp = rewardRows.find((r) => r.reward_type === "xp")?.amount;
    const expectedGold = rewardRows.find((r) => r.reward_type === "gold")?.amount;
    const expectedSkillXp = Object.fromEntries(
      rewardRows.filter((r) => r.reward_type === "skill_xp").map((r) => [r.reward_key, r.amount])
    );
    assert.ok(expectedXp > 0 && expectedGold > 0, "sanity: authored cracks_in_the_compact carries positive xp + gold");
    assert.ok(Object.keys(expectedSkillXp).length >= 1, "sanity: authored quest carries at least one skill_xp reward");

    // Accept — mirrors /api/quests/accept's own INSERT (a real player_quests
    // row against the world_quests id, not System A's startQuest).
    db.prepare(`
      INSERT INTO player_quests (id, user_id, quest_id, world_id, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(crypto.randomUUID(), USER, MAIN_QUEST_ID, WORLD);

    // Not yet complete — no objectives recorded.
    assert.equal(checkQuestCompletion(db, USER, WORLD, MAIN_QUEST_ID), false);
    assert.equal(
      claimQuestRewards(db, USER, WORLD, MAIN_QUEST_ID).ok, false,
      "cannot claim before completion",
    );

    // Record every objective via the same null-questId production hooks
    // (the shape server.js / routes/worlds.js fire). Two talk_to/archivist_maren
    // rows (req 1 and req 2) both match talk_to progress, so two events
    // complete both.
    recordObjectiveProgress(db, USER, WORLD, null, "reach_location", "shadow_archive_entrance", 1);
    recordObjectiveProgress(db, USER, WORLD, null, "talk_to", "archivist_maren", 1);
    recordObjectiveProgress(db, USER, WORLD, null, "gather", "vault_manifest_fragment", 2);
    recordObjectiveProgress(db, USER, WORLD, null, "talk_to", "archivist_maren", 1);

    // recordObjectiveProgress auto-fires checkQuestCompletion on the last
    // objective — the player_quests row should now be 'completed'.
    const pq = db.prepare(
      "SELECT status FROM player_quests WHERE user_id = ? AND world_id = ? AND quest_id = ?"
    ).get(USER, WORLD, MAIN_QUEST_ID);
    assert.equal(pq.status, "completed", "all four objectives recorded → quest auto-completes");

    // Claim — grants the real authored reward.
    const claim = claimQuestRewards(db, USER, WORLD, MAIN_QUEST_ID);
    assert.equal(claim.ok, true);

    const grantedXp = claim.rewards.find((g) => g.type === "xp");
    const grantedGold = claim.rewards.find((g) => g.type === "gold");
    assert.equal(grantedXp?.amount, expectedXp);
    assert.equal(grantedGold?.amount, expectedGold);
    for (const [skill, amount] of Object.entries(expectedSkillXp)) {
      const g = claim.rewards.find((x) => x.type === "skill_xp" && x.skill === skill);
      assert.ok(g, `skill_xp reward for ${skill} must be granted`);
      assert.equal(g.amount, amount);
    }

    // The skill_xp grant must have actually landed in player_skill_levels
    // (proves the grant is real, not a returned-but-inert payload).
    for (const [skill, amount] of Object.entries(expectedSkillXp)) {
      const row = db.prepare(
        "SELECT xp FROM player_skill_levels WHERE user_id = ? AND skill_type = ?"
      ).get(USER, skill);
      assert.ok(row, `player_skill_levels must have a row for ${skill}`);
      assert.equal(row.xp, amount, `granted skill xp for ${skill} must persist`);
    }

    // Re-claim is a no-op (status is now 'rewarded').
    const reclaim = claimQuestRewards(db, USER, WORLD, MAIN_QUEST_ID);
    assert.equal(reclaim.ok, false, "reward already claimed → second claim must fail");

    // The completed quest now surfaces on the Completed tab, not the Active one.
    assert.ok(
      !getActiveQuests(db, USER, WORLD).some((q) => q.id === MAIN_QUEST_ID),
      "a rewarded quest is not active",
    );
    assert.ok(
      getCompletedQuests(db, USER, WORLD).some((q) => q.id === MAIN_QUEST_ID),
      "a rewarded quest surfaces as completed",
    );
  });

  // ── (d) onboarding tutorial advances past 'cook' from real progress ──
  it("(d) deriveFirstCycleProgress advances past 'cook' once the cook quest's objectives are recorded", () => {
    const USER = "u_bridge_firstcycle";

    db.prepare(`
      INSERT INTO player_quests (id, user_id, quest_id, world_id, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(crypto.randomUUID(), USER, COOK_QUEST_ID, WORLD);

    let progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.currentPhase, "cook", "accepted-but-untouched quest stays on 'cook'");

    // The three real first_cycle_cook objectives, via the exact production
    // hook shapes (reach_location: server.js:33580; gather: gather-node
    // handler; cook: server.js:33519/:33522).
    recordObjectiveProgress(db, USER, WORLD, null, "reach_location", "first_cycle_glade", 1);
    recordObjectiveProgress(db, USER, WORLD, null, "gather", "first_cycle_ingredient", 2);
    progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.currentPhase, "cook", "still 'cook' — the cook objective is untouched");

    recordObjectiveProgress(db, USER, WORLD, null, "cook", "first_cycle_recipe", 1);

    progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.phases[0].complete, true, "first_cycle_cook complete after the real cook hook");
    assert.equal(progress.currentPhase, "eat", "phase advances to the next quest, 'eat'");
    assert.equal(progress.complete, false, "the full first cycle is not done yet");
  });
});
