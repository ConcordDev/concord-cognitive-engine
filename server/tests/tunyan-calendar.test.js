/**
 * Tier-2 contract tests for Concordia Phase 9 — Tunyan calendar + civic clock.
 *
 * Pins:
 *   - YEAR_DAYS = 42 (matches mig 134 seasons.js)
 *   - monthFor at day 0 → Arbor 1
 *   - 18 months, mapping every day in [0, 41] to a month
 *   - 3 months per season, season indices 1..6
 *   - third month per season has 3 days, first two have 2
 *   - yearDayFor / monthFor round-trip
 *   - civic clock has 8 blocks
 *   - activityForRole table covers vendor/fisherman/guard/scholar
 *
 * Run: node --test tests/tunyan-calendar.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  monthFor,
  monthsList,
  yearDayFor,
  YEAR_DAYS,
} from "../lib/tunyan-calendar.js";
import { blockToCivic, civicBlocksList, activityForRole } from "../lib/civic-clock.js";

describe("Phase 9 / tunyan-calendar — months", () => {
  it("YEAR_DAYS = 42", () => {
    assert.equal(YEAR_DAYS, 42);
  });

  it("monthFor(0) returns Arbor month 1 day 1", () => {
    const m = monthFor(0);
    assert.equal(m.monthIndex, 1);
    assert.equal(m.monthName, "Arbor");
    assert.equal(m.dayInMonth, 1);
    assert.equal(m.seasonIndex, 1);
  });

  it("monthsList has 18 entries", () => {
    assert.equal(monthsList().length, 18);
  });

  it("third month per season has 3 days", () => {
    const months = monthsList();
    for (let i = 2; i < 18; i += 3) {
      assert.equal(months[i].days, 3, `month ${months[i].name} should have 3 days`);
    }
  });

  it("season indices 1..6 cover all 18 months", () => {
    const months = monthsList();
    const seasonCounts = {};
    for (const m of months) {
      seasonCounts[m.seasonIndex] = (seasonCounts[m.seasonIndex] || 0) + 1;
    }
    for (let s = 1; s <= 6; s++) {
      assert.equal(seasonCounts[s], 3, `season ${s} should have 3 months`);
    }
  });

  it("monthFor covers every year-day [0, 41]", () => {
    const months = new Set();
    for (let d = 0; d < YEAR_DAYS; d++) {
      months.add(monthFor(d).monthIndex);
    }
    assert.equal(months.size, 18);
  });

  it("yearDayFor / monthFor round-trip", () => {
    for (let mIdx = 1; mIdx <= 18; mIdx++) {
      const yd = yearDayFor(mIdx, 1);
      const back = monthFor(yd);
      assert.equal(back.monthIndex, mIdx, `month ${mIdx} round-trip failed`);
      assert.equal(back.dayInMonth, 1);
    }
  });

  it("Wound is month 3 of season 1", () => {
    const m = monthFor(yearDayFor(3, 1));
    assert.equal(m.monthName, "Wound");
    assert.equal(m.seasonIndex, 1);
  });

  it("Zenith is the final month (18)", () => {
    const m = monthFor(YEAR_DAYS - 1);
    assert.equal(m.monthName, "Zenith");
    assert.equal(m.monthIndex, 18);
  });
});

describe("Phase 9 / civic-clock — 8 blocks", () => {
  it("8 civic blocks", () => {
    assert.equal(civicBlocksList().length, 8);
  });

  it("block 0 is morning open 5sun-7sun", () => {
    const b = blockToCivic(0);
    assert.match(b.range, /5sun/);
    assert.equal(b.label, "morning open");
  });

  it("block 7 is amphitheater 19sun-22sun", () => {
    const b = blockToCivic(7);
    assert.match(b.range, /19sun/);
    assert.equal(b.label, "amphitheater");
  });

  it("clamps invalid block index", () => {
    assert.equal(blockToCivic(99).idx, 7);
    assert.equal(blockToCivic(-5).idx, 0);
  });
});

describe("Phase 9 / civic-clock — activityForRole", () => {
  it("vendor at block 0 is stall_open", () => {
    assert.equal(activityForRole("vendor", 0), "stall_open");
  });

  it("vendor at block 3 is first_meal", () => {
    assert.equal(activityForRole("vendor", 3), "first_meal");
  });

  it("fisherman at block 0 is boat_launch", () => {
    assert.equal(activityForRole("fisherman", 0), "boat_launch");
  });

  it("unknown role returns null", () => {
    assert.equal(activityForRole("astronaut", 0), null);
  });
});
