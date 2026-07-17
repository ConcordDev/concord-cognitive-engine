// Functional regression test for the quests-engine honest-by-construction
// fix (docs/QUESTS_ENGINE_INVESTIGATION.md).
//
// Before this fix: authored quest content (content/quests/*.json) only ever
// reached System A's in-memory registry (server/emergent/quest-engine.js),
// which no live gameplay surface reads. The SQL-backed engine the frontend
// actually queries (server/lib/quests/quest-engine.js — "System B") had
// ZERO rows for any authored quest, so a real player's cook/eat/fight
// actions could never advance /api/tutorial/first-cycle past "cook".
//
// This test proves the real chain end-to-end against a genuinely migrated
// in-memory DB (mirroring server/tests/integration/sub-world-parity.test.js's
// pattern):
//   1. seedContent({db}) bridges the authored first_cycle_cook quest into
//      System B's world_quests + quest_objectives + quest_rewards tables.
//   2. A player_quests row is inserted (mirroring the real /api/quests/accept
//      route's own INSERT — see server.js's "Quest acceptance" handler).
//   3. The REAL objective-tracking hooks — recordObjectiveProgress, called
//      with the EXACT same arguments server.js's /api/world/cook route uses
//      at its two "Quest objective progress" call sites — advance the
//      quest's objectives, not a synthetic quest_progress row insert.
//   4. /api/tutorial/first-cycle's real derivation (deriveFirstCycleProgress)
//      is asserted to move currentPhase from "cook" to "eat" as a result.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";

import { up as upConcordiaWorlds } from "../migrations/042_concordia_worlds.js";
import { up as upQuestStateMachine } from "../migrations/068_quest_state_machine.js";
import { up as upNpcAsymmetry } from "../migrations/128_npc_asymmetry.js";
import { seedContent } from "../lib/content-seeder.js";
import { recordObjectiveProgress } from "../lib/quests/quest-engine.js";
import { deriveFirstCycleProgress } from "../lib/tutorial-first-cycle.js";

const USER  = "u_quests_real_writer_probe";
const WORLD = "concordia-hub";
// Verified against content/quests/onboarding.json — this is the authored
// JSON `id`, not a generated UUID.
const COOK_QUEST_ID = "first_cycle_cook";

let db;

function migrate(database) {
  // Migration 042 ALTERs a pre-existing `player_world_state` table; provide
  // a minimal stand-in so it can run standalone (mirrors the tolerance
  // pattern content-seeder.js itself uses throughout).
  database.exec(`CREATE TABLE IF NOT EXISTS player_world_state (user_id TEXT);`);
  upConcordiaWorlds(database);     // worlds, world_npcs, world_quests, ...
  upQuestStateMachine(database);   // player_quests, quest_objectives, player_quest_progress, quest_rewards
  upNpcAsymmetry(database);        // npc_grudges/preoccupations/desires — content-seeder touches these best-effort
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

describe("Quests real-writer fix — authored content reaches System B and a real player action advances it", () => {
  before(async () => {
    db = new Database(":memory:");
    migrate(db);
    await seedContent({ db });
  });
  after(() => { try { db?.close(); } catch { /* intentional */ } });

  it("seedContent bridges the real first_cycle_cook quest into world_quests (not a synthetic row)", () => {
    const row = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(COOK_QUEST_ID);
    assert.ok(row, "world_quests must have a row for the authored first_cycle_cook quest id");
    assert.equal(row.world_id, WORLD);
    assert.equal(row.status, "available");
    assert.equal(row.giver_npc_id, "concordia_first_breath");
    assert.ok(row.title && row.title.length > 0);
  });

  it("seedContent bridges the authored objectives into quest_objectives, faithfully mapped", () => {
    const objs = db.prepare(
      "SELECT type, target, required_count, description FROM quest_objectives WHERE quest_id = ? ORDER BY order_index"
    ).all(COOK_QUEST_ID);
    // Matches content/quests/onboarding.json's first_cycle_cook.objectives exactly.
    assert.deepEqual(objs.map((o) => [o.type, o.target, o.required_count]), [
      ["reach_location", "first_cycle_glade", 1],
      ["gather", "first_cycle_ingredient", 2],
      ["cook", "first_cycle_recipe", 1],
    ]);
    for (const o of objs) assert.ok(o.description && o.description.length > 0);
  });

  it("seedContent bridges the safely-mappable rewards (xp, gold, skill_xp) into quest_rewards", () => {
    const rewards = db.prepare(
      "SELECT reward_type, reward_key, amount FROM quest_rewards WHERE quest_id = ? ORDER BY reward_type, reward_key"
    ).all(COOK_QUEST_ID);
    // content/quests/onboarding.json's first_cycle_cook.rewards = { xp: 30, gold: 0,
    // skill_xp: { cooking: 25, instinct: 10 } }. gold is 0 so it's correctly omitted
    // (mapAuthoredRewardsToSystemB only forwards positive amounts).
    const byKey = Object.fromEntries(rewards.map((r) => [r.reward_key ?? r.reward_type, r.amount]));
    assert.equal(byKey.xp, 30);
    assert.equal(byKey.cooking, 25);
    assert.equal(byKey.instinct, 10);
    assert.ok(!rewards.some((r) => r.reward_type === "gold"), "gold:0 must not produce a reward row");
  });

  it("is idempotent across a simulated process restart (no duplicate objective/reward rows)", async () => {
    const before1 = db.prepare("SELECT COUNT(*) c FROM quest_objectives WHERE quest_id = ?").get(COOK_QUEST_ID).c;
    const beforeR = db.prepare("SELECT COUNT(*) c FROM quest_rewards WHERE quest_id = ?").get(COOK_QUEST_ID).c;
    assert.ok(before1 > 0 && beforeR > 0, "sanity: rows exist from the first seed");

    // content-seeder.js's own _seeded flag is a module-level variable that
    // resets on every real process restart but NOT on a second same-process
    // seedContent() call — so calling seedContent({db}) again here would
    // trivially no-op via the cache and prove nothing. Force a genuinely
    // fresh module instance (its own _seeded=false) via a cache-busting
    // specifier, so this actually re-runs seedQuestFile → seedQuestIntoSystemB
    // against the SAME already-seeded db — the exact scenario
    // (`node server.js` restart against a persistent sqlite file) the
    // row-count guard in seedQuestIntoSystemB exists for, since
    // addQuestObjectives/addQuestRewards mint a fresh crypto.randomUUID()
    // per row and so can't dedupe via their own INSERT OR IGNORE alone.
    const fresh = await import(`../lib/content-seeder.js?restart-probe=${Date.now()}`);
    const r2 = await fresh.seedContent({ db });
    assert.equal(r2.ok, true);

    const after1 = db.prepare("SELECT COUNT(*) c FROM quest_objectives WHERE quest_id = ?").get(COOK_QUEST_ID).c;
    const afterR = db.prepare("SELECT COUNT(*) c FROM quest_rewards WHERE quest_id = ?").get(COOK_QUEST_ID).c;
    assert.equal(after1, before1, "no duplicate quest_objectives rows across a simulated restart re-seed");
    assert.equal(afterR, beforeR, "no duplicate quest_rewards rows across a simulated restart re-seed");
  });

  it("a real player action — accept, then the exact production cook-hook calls — advances /api/tutorial/first-cycle past 'cook'", () => {
    // Step 1: accept. Mirrors the real /api/quests/accept route's own
    // INSERT (server.js) — a real player_quests row, not a quest_progress
    // fixture row.
    db.prepare(`
      INSERT INTO player_quests (id, user_id, quest_id, world_id, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(crypto.randomUUID(), USER, COOK_QUEST_ID, WORLD);

    let progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.currentPhase, "cook", "accepted-but-untouched quest must not advance the phase");
    assert.equal(progress.phases[0].status, "active");

    // Step 2: satisfy the first two objectives via the same real hooks
    // fired elsewhere in production (reach-location: server.js:33555;
    // gather: routes/worlds.js's gather-node handler) — setup, not the
    // behavior under test.
    recordObjectiveProgress(db, USER, WORLD, null, "reach_location", "first_cycle_glade", 1);
    recordObjectiveProgress(db, USER, WORLD, null, "gather", "first_cycle_ingredient", 2);

    progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.currentPhase, "cook", "quest must still be open — the cook objective is untouched");

    // Step 3 — THE REAL COOK-HOOK. Exact call shape of server.js's
    // POST /api/world/cook route (both call sites, verified against the
    // live source):
    //   server.js:33494  qe.recordObjectiveProgress(db, userId, resolvedWorldId, null, "cook", recipeId, 1);
    //   server.js:33497  qe.recordObjectiveProgress(db, userId, resolvedWorldId, null, "cook", "first_cycle_recipe", 1);
    const recipeId = "some_other_recipe_not_first_cycle";
    recordObjectiveProgress(db, USER, WORLD, null, "cook", recipeId, 1);
    recordObjectiveProgress(db, USER, WORLD, null, "cook", "first_cycle_recipe", 1);

    progress = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
    assert.equal(progress.phases[0].complete, true, "first_cycle_cook must be complete after the real cook-hook fires");
    assert.equal(progress.phases[0].status, "complete");
    assert.notEqual(progress.currentPhase, "cook", "currentPhase must have advanced off 'cook'");
    assert.equal(progress.currentPhase, "eat", "currentPhase must land on the next phase, 'eat'");
    assert.equal(progress.complete, false, "the full 8-quest first-cycle is not complete yet");

    // Cross-check against the underlying System B row directly (not just
    // through the derivation helper) — proves the write really landed.
    const pq = db.prepare(
      "SELECT status FROM player_quests WHERE user_id = ? AND world_id = ? AND quest_id = ?"
    ).get(USER, WORLD, COOK_QUEST_ID);
    assert.equal(pq.status, "completed");
  });
});
