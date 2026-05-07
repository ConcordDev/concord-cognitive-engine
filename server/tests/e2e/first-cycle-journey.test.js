/**
 * Tier-3 end-to-end onboarding journey test:
 *   first_cycle_cook → first_cycle_eat → first_cycle_fight → first_cycle_commune
 *
 * Drives each authored quest in content/quests/onboarding.json by inserting
 * progress rows into a :memory: SQLite database, then asserts the
 * /api/tutorial/first-cycle helper advances `currentPhase` correctly at
 * every transition and finally lands on `currentPhase: "complete"`.
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

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function setupDb() {
  // Minimal subset of the quest_progress schema the helper reads.
  // The full schema lives in server/migrations/* — here we recreate just
  // the columns the journey-derivation needs.
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE quest_progress (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      quest_id      TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      UNIQUE(user_id, world_id, quest_id)
    );
  `);
}

function startQuest(questId) {
  db.prepare(`
    INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?)
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='in_progress', completed_at=NULL
  `).run(`qp_${questId}`, USER, WORLD, questId, nowISO());
}

function completeQuest(questId) {
  db.prepare(`
    INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at, completed_at)
    VALUES (?, ?, ?, ?, 'complete', ?, ?)
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='complete', completed_at=excluded.completed_at
  `).run(`qp_${questId}`, USER, WORLD, questId, nowISO(), nowISO());
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

  it("reflects in_progress without advancing the phase pointer", () => {
    startQuest("first_cycle_cook");
    const r = progress();
    assert.equal(r.currentPhase, "cook", "in_progress quests must NOT count as complete");
    assert.equal(r.phases[0].status, "in_progress");
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

  it("accepts both 'complete' and 'completed' status strings", () => {
    db.prepare(`
      INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at, completed_at)
      VALUES (?, ?, ?, 'first_cycle_cook', 'completed', ?, ?)
    `).run("qp_alt", USER, WORLD, nowISO(), nowISO());
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

describe("First Cycle E2E — quest engine signature mismatch", () => {
  beforeEach(setupDb);
  after(() => { try { db?.close(); } catch (_) { /* intentional */ } });

  it("ignores a 1-arg getQuestProgress and falls through to the DB", () => {
    // The actual emergent/quest-engine.js exports a single-arg signature;
    // the helper detects this and uses the DB fallback. Pre-fix, the route
    // attempted to call it with 4 args and silently produced wrong data.
    completeQuest("first_cycle_cook");
    const fakeEngine = { getQuestProgress: (id) => ({ status: "wrong", id }) };
    const r = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD, questEngine: fakeEngine });
    assert.equal(r.phases[0].status, "complete", "must trust DB row, not 1-arg engine result");
    assert.equal(r.currentPhase, "eat");
  });

  it("uses a 4-arg getQuestProgress when its signature matches", () => {
    const fakeEngine = {
      getQuestProgress: (_db, _u, _w, qid) => qid === "first_cycle_cook"
        ? { status: "complete", completedAt: nowISO() }
        : null,
    };
    const r = deriveFirstCycleProgress({ db, userId: USER, worldId: WORLD, questEngine: fakeEngine });
    assert.equal(r.phases[0].complete, true);
    assert.equal(r.currentPhase, "eat");
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
