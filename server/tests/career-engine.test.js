// WAVE JOBS keystone — activity→wage→promotion + the 4-gate. Pins that the real
// activity's performanceScore drives BOTH pay and promotion XP, the 4 gates all
// gate, the promotion trio fires, and mastery tiers stamp a permanent multiplier.
//
// Run: node --test tests/career-engine.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  promotionReady, shiftPay, promotionXp, masteryMultiplierFor, promotionReward, chooseBranch,
  DEFAULT_PERF_THRESHOLD, MASTERY_MULT_TIER10, MASTERY_MULT_TIER5,
} from "../lib/career-engine.js";
import { tierInfo } from "../lib/professions.js";

describe("4-gate promotion", () => {
  const full = { skillLevel: 100, dailyTaskDone: true, performanceScore: 0.9, reputation: 5 };
  it("promotes only when all four gates hold", () => {
    const r = promotionReady(full, "chef", 3);
    assert.equal(r.ready, true);
    assert.equal(r.nextTier, 4);
  });
  it("any single failing gate blocks promotion", () => {
    assert.equal(promotionReady({ ...full, dailyTaskDone: false }, "chef", 3).ready, false);
    assert.equal(promotionReady({ ...full, performanceScore: 0.3 }, "chef", 3).ready, false);
    assert.equal(promotionReady({ ...full, skillLevel: 0 }, "chef", 3).ready, false);
    assert.equal(promotionReady({ ...full, reputation: -1 }, "chef", 3, { repThreshold: 0 }).ready, false);
  });
  it("can't promote past the top tier", () => {
    assert.equal(promotionReady(full, "chef", 10).ready, false);
  });
  it("the skill gate scales with tier", () => {
    // tier-8 needs skill ≥ 80; 70 fails, 80 passes
    assert.equal(promotionReady({ ...full, skillLevel: 70 }, "chef", 8).gates.skill, false);
    assert.equal(promotionReady({ ...full, skillLevel: 80 }, "chef", 8).gates.skill, true);
  });
});

describe("activity → wage + XP", () => {
  it("performanceScore scales pay 0.5×–1.5× of the tier wage base", () => {
    const base = tierInfo("chef", 5).wageBase;
    assert.equal(shiftPay(0, "chef", 5), Math.round(base * 0.5));
    assert.equal(shiftPay(1, "chef", 5), Math.round(base * 1.5));
    assert.ok(shiftPay(0.9, "chef", 5) > shiftPay(0.3, "chef", 5)); // do it well, earn more
  });
  it("promotion XP is performance-weighted", () => {
    assert.ok(promotionXp(0.9) > promotionXp(0.1));
    assert.equal(promotionXp(0), 10);
    assert.equal(promotionXp(1), 50);
  });
  it("mastery multiplier stacks onto pay (permanent)", () => {
    const plain = shiftPay(1, "chef", 6, { masteryTierReached: 0 });
    const mastered = shiftPay(1, "chef", 6, { masteryTierReached: 10 });
    assert.ok(mastered > plain);
    assert.equal(masteryMultiplierFor(10), MASTERY_MULT_TIER10);
    assert.equal(masteryMultiplierFor(5), MASTERY_MULT_TIER5);
    assert.equal(masteryMultiplierFor(3), 1.0);
  });
});

describe("promotion trio + branch", () => {
  it("a promotion delivers wage + public title + unlock (+ mastery mult at 5/10)", () => {
    const r = promotionReward("chef", 5);
    assert.ok(r.wage > 0);
    assert.equal(r.title, "Sous Chef");
    assert.equal(r.unlock, "chef:tier-5");
    assert.equal(r.masteryMultiplier, MASTERY_MULT_TIER5);
    assert.equal(r.isMastery, true);
    assert.equal(promotionReward("chef", 3).masteryMultiplier, 1.0);
  });
  it("branch only at tier 5, only valid options", () => {
    assert.deepEqual(chooseBranch("chef", 5, "mixologist"), { ok: true, branch: "mixologist" });
    assert.equal(chooseBranch("chef", 4, "mixologist").ok, false);
    assert.equal(chooseBranch("chef", 5, "astronaut").ok, false);
  });
  it("DEFAULT_PERF_THRESHOLD is the work-performance bar", () => {
    assert.ok(DEFAULT_PERF_THRESHOLD > 0 && DEFAULT_PERF_THRESHOLD < 1);
  });
});
