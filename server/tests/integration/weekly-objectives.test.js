/**
 * D2 — weekly meta objective chain.
 *
 * Pins:
 *   - ensureWeek seeds the catalog idempotently per (user, week)
 *   - real-event progress (via recordObjectiveProgressFromEvent) bumps the
 *     matching objective and completes it at target
 *   - claim credits CC once (idempotent), and only when completed
 *   - the chain resets across week boundaries (week_key scoping)
 *
 * Run: node --test tests/integration/weekly-objectives.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up272 } from "../../migrations/272_weekly_objectives.js";
import {
  ensureWeek, getWeeklyObjectives, recordObjectiveProgress,
  recordObjectiveProgressFromEvent, claimObjectiveReward, currentWeekKey,
  WEEKLY_OBJECTIVE_CATALOG,
} from "../../lib/weekly-objectives.js";

function freshDb() {
  const db = new Database(":memory:");
  up272(db);
  // CC lives in users.concordia_credits (mig 045); rewards log to reward_ledger (mig 296).
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
  `);
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 0)`).run();
  return db;
}

// A fixed week-1 and week-2 timestamp (different ISO weeks).
const WEEK_A = Date.parse("2026-05-27T12:00:00Z"); // W22
const WEEK_B = Date.parse("2026-06-03T12:00:00Z"); // W23

describe("D2 — weekly objectives", () => {
  it("seeds the catalog idempotently per (user, week)", () => {
    const db = freshDb();
    ensureWeek(db, "u1", WEEK_A);
    ensureWeek(db, "u1", WEEK_A); // re-seed is a no-op
    const objs = getWeeklyObjectives(db, "u1", WEEK_A);
    assert.equal(objs.length, WEEKLY_OBJECTIVE_CATALOG.length);
    assert.ok(objs.every((o) => o.progress === 0 && !o.completed));
    db.close();
  });

  it("progresses + completes the matching objective at target", () => {
    const db = freshDb();
    const slayer = WEEKLY_OBJECTIVE_CATALOG.find((o) => o.objectiveId === "weekly_slayer");
    // fire combat:kill target-1 times → not yet complete
    for (let i = 0; i < slayer.target - 1; i++) recordObjectiveProgressFromEvent(db, "u1", "combat:kill", WEEK_A);
    let obj = getWeeklyObjectives(db, "u1", WEEK_A).find((o) => o.objectiveId === "weekly_slayer");
    assert.equal(obj.progress, slayer.target - 1);
    assert.equal(obj.completed, false);
    // last kill completes it
    const r = recordObjectiveProgressFromEvent(db, "u1", "combat:kill", WEEK_A);
    assert.equal(r.completed.length, 1);
    obj = getWeeklyObjectives(db, "u1", WEEK_A).find((o) => o.objectiveId === "weekly_slayer");
    assert.equal(obj.completed, true);
    db.close();
  });

  it("claims reward CC once, only when completed", () => {
    const db = freshDb();
    ensureWeek(db, "u1", WEEK_A);
    // not completed yet → reject
    assert.equal(claimObjectiveReward(db, "u1", "weekly_trader", WEEK_A).reason, "not_completed");
    // complete it
    recordObjectiveProgress(db, "u1", "market_sale", 5, WEEK_A);
    const trader = WEEKLY_OBJECTIVE_CATALOG.find((o) => o.objectiveId === "weekly_trader");
    const c1 = claimObjectiveReward(db, "u1", "weekly_trader", WEEK_A);
    assert.equal(c1.ok, true);
    assert.equal(c1.rewardCc, trader.rewardCc);
    assert.equal(db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id='u1'`).get().balance, trader.rewardCc);
    // second claim is rejected
    assert.equal(claimObjectiveReward(db, "u1", "weekly_trader", WEEK_A).reason, "already_claimed");
    // balance unchanged
    assert.equal(db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id='u1'`).get().balance, trader.rewardCc);
    db.close();
  });

  it("resets across week boundaries", () => {
    const db = freshDb();
    recordObjectiveProgress(db, "u1", "combat_kill", 10, WEEK_A);
    assert.notEqual(currentWeekKey(WEEK_A), currentWeekKey(WEEK_B));
    // next week starts fresh
    const next = getWeeklyObjectives(db, "u1", WEEK_B);
    // auto-seeds zero-progress; need ensureWeek for the fresh week
    ensureWeek(db, "u1", WEEK_B);
    const objs = getWeeklyObjectives(db, "u1", WEEK_B);
    assert.ok(objs.every((o) => o.progress === 0));
    // last week's progress is preserved in its own row
    const lastWeek = getWeeklyObjectives(db, "u1", WEEK_A).find((o) => o.objectiveId === "weekly_slayer");
    assert.equal(lastWeek.progress, 10);
    db.close();
  });
});
