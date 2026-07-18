/**
 * Tier-3 end-to-end onboarding journey test:
 *   first_cycle_cook → first_cycle_eat → first_cycle_fight → first_cycle_commune
 *   → first_cycle_befriend → first_cycle_sneak → first_cycle_kingdom_visit → first_cycle_play
 *
 * Drives each authored quest in content/quests/onboarding.json by inserting
 * rows into System B's real schema (world_quests / player_quests —
 * migrations 042 + 068) in a :memory: SQLite database, then asserts the
 * /api/tutorial/first-cycle helper advances `currentPhase` correctly at
 * every transition and finally lands on `currentPhase: "complete"`.
 *
 * History note (2026-07): this test used to seed a `quest_progress`
 * (singular) table that had zero production writers anywhere in the
 * codebase — deriveFirstCycleProgress no longer reads that table at all.
 * See docs/QUESTS_ENGINE_INVESTIGATION.md Finding 4 and
 * server/tests/quests-real-writer.test.js (which additionally proves a REAL
 * gameplay hook — recordObjectiveProgress, as called from the /world/cook
 * route — advances phase, not just a synthetic row insert).
 *
 * Run: node --test tests/e2e/first-cycle-journey.test.js
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  deriveFirstCycleProgress,
  FIRST_CYCLE_QUEST_IDS,
  FIRST_CYCLE_PHASE_BY_QUEST,
} from "../../lib/tutorial-first-cycle.js";

let db;
const USER  = "u_test_player";
const WORLD = "concordia-hub";

function setupDb() {
  // Minimal replica of System B's real schema (migrations 042 + 068) — the
  // columns deriveFirstCycleProgress's getActiveQuests / getCompletedQuests
  // / getQuestProgress calls actually touch.
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_quests (
      id             TEXT PRIMARY KEY,
      world_id       TEXT NOT NULL,
      giver_npc_id   TEXT,
      title          TEXT NOT NULL,
      description    TEXT,
      objectives_json TEXT DEFAULT '[]',
      reward_json    TEXT DEFAULT '{}',
      status         TEXT NOT NULL DEFAULT 'available',
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      accepted_by    TEXT,
      completed_at   INTEGER
    );
    CREATE TABLE player_quests (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      quest_id     TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      completed_at INTEGER,
      rewarded_at  INTEGER,
      accepted_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, world_id, quest_id)
    );
    CREATE TABLE quest_objectives (
      id             TEXT PRIMARY KEY,
      quest_id       TEXT NOT NULL,
      type           TEXT NOT NULL,
      target         TEXT NOT NULL,
      required_count INTEGER DEFAULT 1,
      description    TEXT,
      order_index    INTEGER DEFAULT 0
    );
    CREATE TABLE player_quest_progress (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      quest_id      TEXT NOT NULL,
      objective_id  TEXT NOT NULL,
      current_count INTEGER DEFAULT 0,
      completed_at  INTEGER,
      UNIQUE(user_id, world_id, quest_id, objective_id)
    );
    CREATE TABLE quest_rewards (
      id          TEXT PRIMARY KEY,
      quest_id    TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_key  TEXT,
      amount      INTEGER DEFAULT 100
    );
  `);
  // Every FIRST_CYCLE quest needs a catalog row for the INNER JOIN in
  // getActiveQuests/getCompletedQuests to find it at all.
  const insertQuest = db.prepare(
    `INSERT INTO world_quests (id, world_id, title, status) VALUES (?, ?, ?, 'available')`
  );
  for (const qid of FIRST_CYCLE_QUEST_IDS) insertQuest.run(qid, WORLD, qid);
}

function startQuest(questId) {
  db.prepare(`
    INSERT INTO player_quests (id, user_id, quest_id, world_id, status)
    VALUES (?, ?, ?, ?, 'active')
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='active', completed_at=NULL
  `).run(`pq_${questId}`, USER, questId, WORLD);
}

function completeQuest(questId) {
  db.prepare(`
    INSERT INTO player_quests (id, user_id, quest_id, world_id, status, completed_at)
    VALUES (?, ?, ?, ?, 'completed', unixepoch())
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='completed', completed_at=unixepoch()
  `).run(`pq_${questId}`, USER, questId, WORLD);
}

function progress() {
  return deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD });
}

describe("First Cycle E2E journey — cook → eat → fight → commune", () => {
  beforeEach(setupDb);
  after(() => { try { db?.close(); } catch (_) { /* intentional */ } });

  it("starts with currentPhase 'cook' before any quest is started", () => {
    const r = progress();
    assert.equal(r.ok, true);
    assert.equal(r.tutorial, "first_cycle");
    assert.equal(r.currentPhase, "cook");
    assert.equal(r.complete, false);
    // Phase F extended FIRST_CYCLE_QUEST_IDS from 4 → 8 beats.
    assert.equal(r.phases.length, FIRST_CYCLE_QUEST_IDS.length);
    assert.equal(r.phases[0].status, "not_started");
  });

  it("reflects an accepted-but-active quest without advancing the phase pointer", () => {
    startQuest("first_cycle_cook");
    const r = progress();
    assert.equal(r.currentPhase, "cook", "an active (not completed) quest must NOT count as complete");
    assert.equal(r.phases[0].status, "active");
    assert.equal(r.phases[0].complete, false);
  });

  it("advances cook → eat after first_cycle_cook completes", () => {
    completeQuest("first_cycle_cook");
    const r = progress();
    assert.equal(r.currentPhase, "eat");
    assert.equal(r.phases[0].complete, true);
    assert.equal(r.phases[0].status, "complete");
    assert.equal(r.phases[1].complete, false);
  });

  it("advances eat → fight after first_cycle_eat completes", () => {
    completeQuest("first_cycle_cook");
    completeQuest("first_cycle_eat");
    const r = progress();
    assert.equal(r.currentPhase, "fight");
    assert.equal(r.phases[1].complete, true);
    assert.equal(r.phases[2].complete, false);
  });

  it("advances fight → commune after first_cycle_fight completes", () => {
    completeQuest("first_cycle_cook");
    completeQuest("first_cycle_eat");
    completeQuest("first_cycle_fight");
    const r = progress();
    assert.equal(r.currentPhase, "commune");
    assert.equal(r.phases[2].complete, true);
    assert.equal(r.phases[3].complete, false);
  });

  it("lands on currentPhase 'complete' after all eight quests finish", () => {
    for (const q of FIRST_CYCLE_QUEST_IDS) completeQuest(q);
    const r = progress();
    assert.equal(r.currentPhase, "complete");
    assert.equal(r.complete, true);
    for (const p of r.phases) assert.equal(p.complete, true, `${p.questId} must be complete`);
  });

  it("advances commune → befriend → sneak → kingdom_visit → play (Phase F additions)", () => {
    completeQuest("first_cycle_cook");
    completeQuest("first_cycle_eat");
    completeQuest("first_cycle_fight");
    completeQuest("first_cycle_commune");
    let r = progress();
    assert.equal(r.currentPhase, "befriend", "after commune, befriend is next");

    completeQuest("first_cycle_befriend");
    r = progress();
    assert.equal(r.currentPhase, "sneak");

    completeQuest("first_cycle_sneak");
    r = progress();
    assert.equal(r.currentPhase, "kingdom_visit");

    completeQuest("first_cycle_kingdom_visit");
    r = progress();
    assert.equal(r.currentPhase, "play");

    completeQuest("first_cycle_play");
    r = progress();
    assert.equal(r.currentPhase, "complete");
    assert.equal(r.complete, true);
  });

  it("accepts a 'rewarded' status (post reward-claim) as complete too", () => {
    db.prepare(`
      INSERT INTO player_quests (id, user_id, quest_id, world_id, status, completed_at, rewarded_at)
      VALUES ('pq_alt', ?, 'first_cycle_cook', ?, 'rewarded', unixepoch(), unixepoch())
    `).run(USER, WORLD);
    const r = progress();
    assert.equal(r.phases[0].complete, true);
    assert.equal(r.currentPhase, "eat");
  });

  it("constants table covers all eight phases in order", () => {
    // Phase F extended the cycle. Order matters — onboarding voice
    // lines reference these in sequence.
    assert.deepStrictEqual([...FIRST_CYCLE_QUEST_IDS], [
      "first_cycle_cook",
      "first_cycle_eat",
      "first_cycle_fight",
      "first_cycle_commune",
      "first_cycle_befriend",
      "first_cycle_sneak",
      "first_cycle_kingdom_visit",
      "first_cycle_play",
    ]);
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_cook,           "cook");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_eat,            "eat");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_fight,          "fight");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_commune,        "commune");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_befriend,       "befriend");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_sneak,          "sneak");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_kingdom_visit,  "kingdom_visit");
    assert.equal(FIRST_CYCLE_PHASE_BY_QUEST.first_cycle_play,           "play");
  });
});

describe("First Cycle E2E — degrades gracefully without System B tables", () => {
  it("reports not_started (not a throw) when the DB has none of the quest tables", () => {
    const bareDb = new Database(":memory:");
    try {
      const r = deriveFirstCycleProgress({ db: bareDb, userId: USER, worldId: WORLD });
      assert.equal(r.ok, true);
      assert.equal(r.currentPhase, "cook");
      assert.equal(r.complete, false);
      assert.equal(r.phases[0].status, "not_started");
    } finally {
      bareDb.close();
    }
  });
});

describe("First Cycle E2E — content schema sanity", () => {
  it("authored content/quests/onboarding.json declares the four phases in order", async () => {
    const fs   = await import("node:fs/promises");
    const path = await import("node:path");
    const url  = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.resolve(here, "../../../content/quests/onboarding.json");
    const json = JSON.parse(await fs.readFile(file, "utf-8"));

    const ids = json.map((q) => q.id);
    for (const phaseId of FIRST_CYCLE_QUEST_IDS) {
      assert.ok(ids.includes(phaseId), `content/quests/onboarding.json missing ${phaseId}`);
    }
    // Verify follow_up chaining: cook → eat → fight → commune.
    const byId = Object.fromEntries(json.map((q) => [q.id, q]));
    assert.deepStrictEqual(byId.first_cycle_cook.follow_up_quest_ids, ["first_cycle_eat"]);
    assert.deepStrictEqual(byId.first_cycle_eat.follow_up_quest_ids, ["first_cycle_fight"]);
    assert.deepStrictEqual(byId.first_cycle_fight.follow_up_quest_ids, ["first_cycle_commune"]);

    // breadcrumb gating per release_mode='on_completion'
    const cookBc = byId.first_cycle_cook.breadcrumbs[0];
    assert.equal(cookBc.id, "bc_fc_cook_1");
    assert.equal(cookBc.unlocks_after, "obj_fc_cook_3");
    assert.equal(cookBc.release_mode, "on_completion");
  });
});
