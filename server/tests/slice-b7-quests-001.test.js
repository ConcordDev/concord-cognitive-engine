/**
 * Slice B7 — FIX-quests-001: web create + available + accept round-trip
 * for the quests domain macros (server/domains/quests.js).
 *
 * Runs the REAL macros against a REAL in-memory better-sqlite3 DB built
 * by the real migration runner (the quests-domain-macros.test.js
 * harness shape): a posted quest joins the world catalog, shows in
 * `quests.available` for players who have not accepted it, and leaves
 * that list (joining `quests.mine`) once accepted — while staying
 * available to everyone else. Validation refusals ride along.
 *
 * Run: node --test tests/slice-b7-quests-001.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerQuestsMacros from "../domains/quests.js";
import { runMigrations } from "../migrate.js";

const WORLD = "concordia-hub";
const AUTHOR = "user_author";
const OTHER = "user_other";

function buildMacros() {
  const macros = new Map();
  const register = (domain, name, handler) => macros.set(`${domain}.${name}`, handler);
  registerQuestsMacros(register);
  return macros;
}

async function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  await runMigrations(db);
  return db;
}

function makeCtx(db, userId) {
  return { db, actor: { userId }, worldId: WORLD };
}

describe("quests — FIX-quests-001 create / available / accept", () => {
  let macros;
  before(() => { macros = buildMacros(); });

  it("registers the web authoring surface", () => {
    assert.ok(macros.has("quests.available"));
    assert.ok(macros.has("quests.create"));
  });

  it("a posted quest is available to others, acceptable, and leaves their available list", async () => {
    const db = await freshDb();
    const created = await macros.get("quests.create")(makeCtx(db, AUTHOR), {
      title: "Ember Herb Run",
      description: "The apothecary is out.",
      objectives: [{ type: "gather", target: "ember herb", requiredCount: 3 }],
      rewardXp: 50,
    });
    assert.equal(created.ok, true);
    assert.equal(created.quest.title, "Ember Herb Run");
    assert.equal(created.quest.objectives.length, 1);
    assert.equal(created.quest.objectives[0].target, 3);
    const questId = created.quest.id;

    // Available for a second player (and for the author).
    const availOther = await macros.get("quests.available")(makeCtx(db, OTHER), {});
    assert.equal(availOther.ok, true);
    assert.ok(availOther.quests.some((q) => q.id === questId));

    // Accept moves it to the accepter's active list only.
    const accepted = await macros.get("quests.accept")(makeCtx(db, OTHER), { questId });
    assert.equal(accepted.ok, true);
    const availAfter = await macros.get("quests.available")(makeCtx(db, OTHER), {});
    assert.ok(!availAfter.quests.some((q) => q.id === questId));
    const mine = await macros.get("quests.mine")(makeCtx(db, OTHER), {});
    assert.ok(mine.quests.some((q) => q.id === questId));
    // …and it is STILL available to a third player (catalog never flips).
    const availAuthor = await macros.get("quests.available")(makeCtx(db, AUTHOR), {});
    assert.ok(availAuthor.quests.some((q) => q.id === questId));
    db.close();
  });

  it("create refuses a missing title, an unknown objective type, a poisoned count and a poisoned reward", async () => {
    const db = await freshDb();
    const noTitle = await macros.get("quests.create")(makeCtx(db, AUTHOR), {
      objectives: [{ type: "gather", target: "herb" }],
    });
    assert.equal(noTitle.ok, false);
    assert.equal(noTitle.reason, "title_required");

    const badType = await macros.get("quests.create")(makeCtx(db, AUTHOR), {
      title: "X", objectives: [{ type: "bribe", target: "guard" }],
    });
    assert.equal(badType.ok, false);
    assert.equal(badType.reason, "invalid_objective_type");

    const badCount = await macros.get("quests.create")(makeCtx(db, AUTHOR), {
      title: "X", objectives: [{ type: "gather", target: "herb", requiredCount: 1e9 }],
    });
    assert.equal(badCount.ok, false);
    assert.equal(badCount.reason, "invalid_required_count");

    const badReward = await macros.get("quests.create")(makeCtx(db, AUTHOR), {
      title: "X", objectives: [{ type: "gather", target: "herb" }], rewardXp: -5,
    });
    assert.equal(badReward.ok, false);
    assert.equal(badReward.reason, "invalid_rewardXp");
    db.close();
  });
});
