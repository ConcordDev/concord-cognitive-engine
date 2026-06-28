/**
 * Behavioral tests for the quests domain macro surface (server/domains/quests.js).
 *
 * These run the REAL macros against a REAL in-memory better-sqlite3 DB built by
 * the real migration runner, and assert actual computed values across the full
 * lifecycle:
 *
 *   accept → active → record objective progress (monotonic, capped) →
 *   auto-completion → claim reward (exactly once)
 *
 * No mocks of the engine — only a minimal `register` collector + a synthesized
 * ctx (the same shape server.js makeCtx() produces: { db, actor:{ userId } }).
 *
 * Run: node --test tests/quests-domain-macros.test.js
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";

import registerQuestsMacros from "../domains/quests.js";
import { runMigrations } from "../migrate.js";

const WORLD = "concordia-hub";
const USER = "user_test_1";

/** Build a macro registry from the domain module. */
function buildMacros() {
  const macros = new Map();
  const register = (domain, name, handler) => {
    macros.set(`${domain}.${name}`, handler);
  };
  registerQuestsMacros(register);
  return macros;
}

/** Apply all real migrations onto a fresh in-memory DB. */
async function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  await runMigrations(db);
  return db;
}

/** Synthesize the ctx shape server.js passes to macros. */
function makeCtx(db, userId = USER) {
  return { db, actor: { userId }, worldId: WORLD };
}

/** Seed a quest the player has accepted (player_quests active row). */
function seedAcceptedQuest(db, questId, { objectives = [], rewards = [] } = {}) {
  db.prepare(
    `INSERT INTO world_quests (id, world_id, title, description, status)
     VALUES (?, ?, ?, ?, 'available')`
  ).run(questId, WORLD, `Quest ${questId}`, "A test quest");

  db.prepare(
    `INSERT INTO player_quests (id, user_id, quest_id, world_id, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(crypto.randomUUID(), USER, questId, WORLD);

  return { objectives, rewards };
}

describe("quests domain — registration", () => {
  it("registers the full macro surface", () => {
    const m = buildMacros();
    for (const name of [
      "quests.active", "quests.mine", "quests.progress",
      "quests.recordProgress", "quests.checkCompletion", "quests.claimRewards",
      "quests.addObjectives", "quests.addRewards",
    ]) {
      assert.ok(m.has(name), `missing ${name}`);
      assert.equal(typeof m.get(name), "function");
    }
  });
});

describe("quests domain — guard rails", () => {
  let macros;
  before(() => { macros = buildMacros(); });

  it("returns no_db without a db", async () => {
    const r = await macros.get("quests.active")({ actor: { userId: USER } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("returns no_user without an actor", async () => {
    const db = await freshDb();
    const r = await macros.get("quests.active")({ db, actor: {} }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
    db.close();
  });

  it("rejects recordProgress missing objective key", async () => {
    const db = await freshDb();
    const r = await macros.get("quests.recordProgress")(makeCtx(db), { count: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_objective_key");
    db.close();
  });
});

describe("quests domain — full lifecycle round-trip", () => {
  let macros, db;
  const QUEST = "q_lifecycle";

  beforeEach(async () => {
    macros = buildMacros();
    db = await freshDb();
    seedAcceptedQuest(db, QUEST);
    // author 2 objectives + rewards via the macros themselves (no raw SQL)
    await macros.get("quests.addObjectives")(makeCtx(db), {
      questId: QUEST,
      objectives: [
        { type: "kill", target: "wolf", requiredCount: 3, description: "Slay 3 wolves" },
        { type: "gather", target: "herb", requiredCount: 2, description: "Gather 2 herbs" },
      ],
    });
    await macros.get("quests.addRewards")(makeCtx(db), {
      questId: QUEST,
      rewards: [{ rewardType: "gold", amount: 150 }],
    });
  });

  it("active lists the accepted quest with objectives + rewards", async () => {
    const r = await macros.get("quests.active")(makeCtx(db), {});
    assert.equal(r.ok, true);
    assert.equal(r.quests.length, 1);
    assert.equal(r.quests[0].id, QUEST);
    assert.equal(r.quests[0].objectives.length, 2);
    assert.equal(r.quests[0].rewards.length, 1);
  });

  it("mine returns the lens-shaped quest with merged progress", async () => {
    const r = await macros.get("quests.mine")(makeCtx(db), {});
    assert.equal(r.ok, true);
    const q = r.quests[0];
    assert.equal(q.title, `Quest ${QUEST}`);
    assert.equal(q.objectives.length, 2);
    // pre-progress: 0/3 and 0/2, none complete
    assert.deepEqual(
      q.objectives.map((o) => [o.progress, o.target, o.complete]),
      [[0, 3, false], [0, 2, false]],
    );
    assert.equal(q.reward.cc, 150);
  });

  it("objective progress is monotonic and capped at required_count", async () => {
    // overshoot the wolves objective: +5 against a target of 3 → capped at 3
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "kill", target: "wolf", count: 5 });
    let prog = await macros.get("quests.progress")(makeCtx(db), { questId: QUEST });
    const wolf = prog.objectives.find((o) => o.target === "wolf");
    assert.equal(wolf.current_count, 3, "capped at required_count");
    assert.ok(wolf.obj_completed_at, "objective marked complete");

    // a further record must NOT exceed the cap or regress
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "kill", target: "wolf", count: 10 });
    prog = await macros.get("quests.progress")(makeCtx(db), { questId: QUEST });
    assert.equal(prog.objectives.find((o) => o.target === "wolf").current_count, 3);
  });

  it("quest auto-completes only when every objective is done", async () => {
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "kill", target: "wolf", count: 3 });
    // one objective done — quest still active
    let chk = await macros.get("quests.checkCompletion")(makeCtx(db), { questId: QUEST });
    assert.equal(chk.completed, false);
    let active = await macros.get("quests.active")(makeCtx(db), {});
    assert.equal(active.quests.length, 1, "still active with one objective left");

    // finish the gather objective — quest completes
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "gather", target: "herb", count: 2 });
    const row = db.prepare("SELECT status FROM player_quests WHERE quest_id = ?").get(QUEST);
    assert.equal(row.status, "completed");
    // no longer in the active list
    active = await macros.get("quests.active")(makeCtx(db), {});
    assert.equal(active.quests.length, 0);
  });

  it("rewards are granted exactly once", async () => {
    // complete the quest
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "kill", target: "wolf", count: 3 });
    await macros.get("quests.recordProgress")(makeCtx(db), { type: "gather", target: "herb", count: 2 });

    const first = await macros.get("quests.claimRewards")(makeCtx(db), { questId: QUEST });
    assert.equal(first.ok, true);
    assert.ok(Array.isArray(first.rewards));
    assert.equal(first.rewards[0].type, "gold");
    assert.equal(first.rewards[0].amount, 150);
    // player_quests flipped to rewarded
    assert.equal(
      db.prepare("SELECT status FROM player_quests WHERE quest_id = ?").get(QUEST).status,
      "rewarded",
    );

    // second claim must be refused (status is now 'rewarded', not 'completed')
    const second = await macros.get("quests.claimRewards")(makeCtx(db), { questId: QUEST });
    assert.equal(second.ok, false);
    assert.match(second.error, /not completed|already/i);
  });

  it("cannot claim rewards for an incomplete quest", async () => {
    const r = await macros.get("quests.claimRewards")(makeCtx(db), { questId: QUEST });
    assert.equal(r.ok, false);
    assert.match(r.error, /not completed/i);
  });
});
