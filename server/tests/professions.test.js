// WAVE JOBS — profession taxonomy. Pins the schema: every track binds to a real
// playable activity, the 10-tier ladder + tier-scaled wage/skill-gate, the
// branch@5, and category grouping.
//
// Run: node --test tests/professions.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES, TRACKS, activityFor, tierInfo, tracksInCategory, branchOptions,
  resolveBranch, ladderFor, isTrack, MAX_TIER, BRANCH_TIER,
} from "../lib/professions.js";

// the activities a track may bind to must be real Concordia engines
const KNOWN_ACTIVITIES = new Set(["cook", "diagnose", "forge", "combat", "music", "deduction", "marketplace", "glyph", "sport", "brawl", "hacking", "farming"]);

describe("taxonomy integrity", () => {
  it("every track has a category, a known playable activity, a branch pair, and 10 ranks", () => {
    for (const [id, tr] of Object.entries(TRACKS)) {
      assert.ok(CATEGORIES.includes(tr.category), `${id} category`);
      assert.ok(KNOWN_ACTIVITIES.has(tr.activity), `${id} activity ${tr.activity}`);
      assert.equal(tr.branchAt5.length, 2, `${id} branch pair`);
      assert.equal(tr.ranks.length, MAX_TIER, `${id} 10 ranks`);
    }
  });
  it("every category has at least one track", () => {
    for (const c of CATEGORIES) assert.ok(tracksInCategory(c).length >= 1, `category ${c} empty`);
  });
});

describe("tier ladder", () => {
  it("wage + skill-gate scale monotonically with tier", () => {
    const t1 = tierInfo("chef", 1), t5 = tierInfo("chef", 5), t10 = tierInfo("chef", 10);
    assert.ok(t10.wageBase > t5.wageBase && t5.wageBase > t1.wageBase);
    assert.ok(t10.skillGate > t1.skillGate);
    assert.equal(t1.title, "Dishwasher");
    assert.equal(t10.title, "Culinary Legend");
  });
  it("tiers 5 and 10 are mastery (permanent-multiplier) points; 5 is the branch", () => {
    assert.equal(tierInfo("chef", BRANCH_TIER).isBranchPoint, true);
    assert.equal(tierInfo("chef", BRANCH_TIER).isMastery, true);
    assert.equal(tierInfo("chef", MAX_TIER).isMastery, true);
    assert.equal(tierInfo("chef", 3).isMastery, false);
  });
  it("clamps out-of-range tiers + full ladder has 10 entries", () => {
    assert.equal(tierInfo("chef", 99).tier, 10);
    assert.equal(tierInfo("chef", 0).tier, 1);
    assert.equal(ladderFor("chef").length, 10);
  });
});

describe("branching + binding", () => {
  it("activityFor returns the bound lens; unknown track → null", () => {
    assert.equal(activityFor("athlete"), "sport");
    assert.equal(activityFor("mage"), "glyph");
    assert.equal(activityFor("nope"), null);
  });
  it("branch resolves only valid options at tier 5", () => {
    assert.deepEqual(branchOptions("chef"), ["chef", "mixologist"]);
    assert.equal(resolveBranch("chef", "mixologist"), "mixologist");
    assert.equal(resolveBranch("chef", "astronaut"), null);
  });
  it("isTrack guards", () => {
    assert.equal(isTrack("trader"), true);
    assert.equal(isTrack("wizard-of-oz"), false);
  });
});
