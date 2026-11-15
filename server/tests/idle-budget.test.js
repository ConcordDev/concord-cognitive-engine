// IDLE-01 (GB-1540) — the idle throttle's hard half, pinned hermetically:
// the default weights carry ≥90% of idle actions deterministically, and
// the per-citizen per-day model-call budget admits exactly its number
// of calls, counts the blocks, survives by day, and makes the 90/10
// split a query. Runs on node:sqlite (API-compatible with the
// better-sqlite3 prepare/run/get surface this lib uses).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  idleDailyBudget,
  idleDayKey,
  recordIdleOutcome,
  idleModelCallsToday,
  trySpendIdleModelCall,
  idleSplit,
  lastIdleSampleSig,
  setIdleSampleSig,
} from "../lib/idle-budget.js";
import { IDLE_WEIGHT_DEFAULTS } from "../emergent/idle-behavior.js";

const DAY = Date.UTC(2026, 10, 14, 12, 0, 0); // 2026-11-14T12:00Z

function freshDb() {
  return new DatabaseSync(":memory:");
}

describe("IDLE-01 idle budget", () => {
  it("default weights make at least 90% of idle actions deterministic", () => {
    const total = Object.values(IDLE_WEIGHT_DEFAULTS).reduce((a, b) => a + b, 0);
    const deterministic = IDLE_WEIGHT_DEFAULTS.browse_lens;
    assert.ok(deterministic / total >= 0.9, `${deterministic}/${total} < 0.9`);
    assert.equal(total - deterministic, 3); // the three brain actions share the rest
  });

  it("the budget defaults to 12 and honours the env override", () => {
    assert.equal(idleDailyBudget({}), 12);
    assert.equal(idleDailyBudget({ CONCORD_IDLE_DAILY_BUDGET: "5" }), 5);
    assert.equal(idleDailyBudget({ CONCORD_IDLE_DAILY_BUDGET: "junk" }), 12);
  });

  it("admits exactly the budget's calls, then blocks and counts the blocks", () => {
    const db = freshDb();
    for (let i = 0; i < 3; i++) assert.equal(trySpendIdleModelCall(db, "cit_a", 3, DAY), true);
    assert.equal(trySpendIdleModelCall(db, "cit_a", 3, DAY), false);
    assert.equal(trySpendIdleModelCall(db, "cit_a", 3, DAY), false);
    assert.equal(idleModelCallsToday(db, "cit_a", DAY), 3);
    const row = db.prepare(
      "SELECT budget_blocks FROM emergent_idle_daily WHERE emergent_id = 'cit_a'",
    ).get();
    assert.equal(row.budget_blocks, 2);
  });

  it("budgets are per-citizen and reset on the next UTC day", () => {
    const db = freshDb();
    assert.equal(trySpendIdleModelCall(db, "cit_a", 1, DAY), true);
    assert.equal(trySpendIdleModelCall(db, "cit_a", 1, DAY), false);
    assert.equal(trySpendIdleModelCall(db, "cit_b", 1, DAY), true);
    assert.equal(trySpendIdleModelCall(db, "cit_a", 1, DAY + 86400_000), true);
    assert.equal(idleDayKey(DAY), "2026-11-14");
    assert.equal(idleDayKey(DAY + 86400_000), "2026-11-15");
  });

  it("the 90/10 split is a query over the outcome counters", () => {
    const db = freshDb();
    for (let i = 0; i < 27; i++) recordIdleOutcome(db, "cit_a", "deterministic", DAY);
    for (let i = 0; i < 3; i++) recordIdleOutcome(db, "cit_a", "model", DAY);
    recordIdleOutcome(db, "cit_a", "cooldown", DAY);
    const split = idleSplit(db, 1, DAY);
    assert.equal(split.model, 3);
    assert.equal(split.deterministic, 27);
    assert.ok(Math.abs(split.modelShare - 0.1) < 1e-9);
  });

  it("the sample signature round-trips per citizen per day (IDLE-02's repeat leg storage)", () => {
    const db = freshDb();
    assert.equal(lastIdleSampleSig(db, "cit_a", DAY), null);
    setIdleSampleSig(db, "cit_a", "wood|wood", DAY);
    assert.equal(lastIdleSampleSig(db, "cit_a", DAY), "wood|wood");
    assert.equal(lastIdleSampleSig(db, "cit_a", DAY + 86400_000), null);
  });

  it("a missing db never throws and never blocks (pre-budget behaviour)", () => {
    assert.equal(trySpendIdleModelCall(null, "cit_a", 0, DAY), true);
    recordIdleOutcome(null, "cit_a", "model", DAY);
    assert.deepEqual(idleSplit(null), { model: 0, deterministic: 0, modelShare: null });
  });
});
