// Slice-of-Life — the day-clock time-economy (viability cone over time). Pins
// verb costs, the finite daily budget, day_full rejection, fresh-day reset, and
// the day-as-simplex allocation.
//
// Run: node --test tests/day-clock.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  costOf, remaining, canAfford, dayAllocation, slotsUsed, spendSlots, dayState, SLOTS_PER_DAY,
} from "../lib/day-clock.js";

describe("pure model", () => {
  it("verb costs + remaining + affordability", () => {
    assert.equal(costOf("work_shift"), 3);
    assert.equal(costOf("hang_out"), 1);
    assert.equal(costOf("unknown_verb"), 1); // default
    assert.equal(remaining(2, 6), 4);
    assert.equal(canAfford("work_shift", 4, 6), false); // 3 > 2 left
    assert.equal(canAfford("hang_out", 5, 6), true);
  });
  it("the day is a simplex — allocations are day fractions summing ≤ 1", () => {
    const alloc = dayAllocation([{ verb: "work_shift", slots: 3 }, { verb: "hang_out", slots: 1 }], 6);
    assert.ok(Math.abs(alloc.work_shift - 0.5) < 1e-9);
    assert.ok(Object.values(alloc).reduce((a, b) => a + b, 0) <= 1);
  });
});

describe("DB ledger", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); delete process.env.CONCORD_DAY_SLOTS; });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("spends slots and decrements the day; the same day accumulates", () => {
    assert.equal(slotsUsed(db, "u1", 10), 0);
    const a = spendSlots(db, "u1", 10, "work_shift");
    assert.equal(a.ok, true);
    assert.equal(a.remaining, SLOTS_PER_DAY() - 3);
    const b = spendSlots(db, "u1", 10, "hang_out");
    assert.equal(b.slotsUsed, 4);
  });

  it("rejects a verb once the day is full", () => {
    spendSlots(db, "u1", 10, "work_shift"); // 3
    spendSlots(db, "u1", 10, "go_drinking"); // 2 → 5
    const over = spendSlots(db, "u1", 10, "go_drinking"); // needs 2, only 1 left
    assert.equal(over.ok, false);
    assert.equal(over.reason, "day_full");
  });

  it("a new day index starts fresh", () => {
    spendSlots(db, "u1", 10, "work_shift");
    assert.equal(slotsUsed(db, "u1", 11), 0);           // next day
    assert.equal(spendSlots(db, "u1", 11, "work_shift").ok, true);
  });

  it("dayState exposes the allocation simplex + remaining", () => {
    spendSlots(db, "u1", 10, "work_shift");
    spendSlots(db, "u1", 10, "court");
    const s = dayState(db, "u1", 10);
    assert.equal(s.slotsUsed, 4);
    assert.ok(s.allocation.work_shift > 0 && s.allocation.court > 0);
    assert.ok(Object.values(s.allocation).reduce((a, b) => a + b, 0) <= 1 + 1e-9);
  });
});
